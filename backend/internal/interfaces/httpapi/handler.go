// Package httpapi is the Gin adapter for the immutable exercise API.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gin-gonic/gin"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	"io"
	"log/slog"
	"strings"
	"time"
)

type Queries interface {
	Goal(context.Context, string) (domain.Goal, error)
	List(context.Context, domain.Status) ([]domain.Goal, error)
	Wallet(context.Context) (domain.Wallet, error)
}
type Commands interface {
	Create(context.Context, domain.CreateInput) (domain.Goal, error)
	Deposit(context.Context, string, string, domain.Money) (application.Receipt, error)
	Cancel(context.Context, string) (domain.Wallet, error)
	Reset(context.Context) error
}
type Metrics interface {
	HTTP(string, string, int, time.Duration)
}
type Options struct {
	Origins        []string
	Logger         *slog.Logger
	Metrics        Metrics
	RequestTimeout time.Duration
}

func New(query Queries, commands Commands, options Options) *gin.Engine {
	if options.Logger == nil {
		options.Logger = slog.New(slog.NewJSONHandler(io.Discard, nil))
	}
	if options.RequestTimeout <= 0 {
		options.RequestTimeout = 5 * time.Second
	}
	router := gin.New()
	router.RedirectTrailingSlash = false
	router.RedirectFixedPath = false
	router.SetTrustedProxies(nil)
	router.Use(middleware(options))
	router.NoRoute(func(c *gin.Context) { writeError(c, domain.NotFound()) })
	api := router.Group("/api")
	api.POST("/reset", func(c *gin.Context) {
		if err := commands.Reset(c.Request.Context()); err != nil {
			writeError(c, err)
			return
		}
		respond(c, 200, map[string]bool{"ok": true})
	})
	api.GET("/wallet", func(c *gin.Context) {
		wallet, err := query.Wallet(c.Request.Context())
		if err != nil {
			writeError(c, err)
			return
		}
		respond(c, 200, walletDTO(wallet))
	})
	api.GET("/goals", func(c *gin.Context) {
		list, err := query.List(c.Request.Context(), domain.Status(c.Query("status")))
		if err != nil {
			writeError(c, err)
			return
		}
		out := make([]goalDTO, 0, len(list))
		for _, g := range list {
			out = append(out, goalDTO(g))
		}
		respond(c, 200, map[string]any{"goals": out})
	})
	api.GET("/goals/:id", func(c *gin.Context) {
		goal, err := query.Goal(c.Request.Context(), c.Param("id"))
		if err != nil {
			writeError(c, err)
			return
		}
		respond(c, 200, map[string]any{"goal": goalDTO(goal)})
	})
	api.POST("/goals", func(c *gin.Context) {
		var body createDTO
		if err := decode(c.Writer, c.Request, &body, "name", "targetAmount", "deadline", "fundingSource", "acceptedTerms"); err != nil {
			writeError(c, err)
			return
		}
		goal, err := commands.Create(c.Request.Context(), domain.CreateInput(body))
		if err != nil {
			writeError(c, err)
			return
		}
		respond(c, 201, map[string]any{"goal": goalDTO(goal)})
	})
	api.POST("/goals/:id/deposits", func(c *gin.Context) {
		key := strings.TrimSpace(c.GetHeader("Idempotency-Key"))
		if key == "" {
			writeError(c, &domain.Error{Code: "MISSING_IDEMPOTENCY_KEY", Message: "کلید یکتای واریز الزامی است."})
			return
		}
		var body struct {
			Amount domain.Money `json:"amount"`
		}
		if err := decode(c.Writer, c.Request, &body, "amount"); err != nil {
			writeError(c, err)
			return
		}
		receipt, err := commands.Deposit(c.Request.Context(), c.Param("id"), key, body.Amount)
		if err != nil {
			writeError(c, err)
			return
		}
		respond(c, 200, depositDTO{Goal: goalDTO(receipt.Result.Goal), Wallet: walletDTO(receipt.Result.Wallet)})
	})
	api.POST("/goals/:id/cancel", func(c *gin.Context) {
		wallet, err := commands.Cancel(c.Request.Context(), c.Param("id"))
		if err != nil {
			writeError(c, err)
			return
		}
		respond(c, 200, map[string]any{"wallet": walletDTO(wallet)})
	})
	return router
}
func respond(c *gin.Context, status int, value any) {
	c.Status(status)
	if err := json.NewEncoder(c.Writer).Encode(value); err != nil {
		c.Set("write_failed", true)
	}
}
func writeError(c *gin.Context, err error) {
	status := 500
	body := errorDTO{Code: "INTERNAL", Message: "خطایی در سرور رخ داد. نتیجهٔ واریز را با همان درخواست پیگیری کنید."}
	var business *domain.Error
	if errors.As(err, &business) {
		switch business.Code {
		case "VALIDATION", "MISSING_IDEMPOTENCY_KEY":
			status = 400
		case "NOT_FOUND":
			status = 404
		case "NOT_ALLOWED", "IDEMPOTENCY_CONFLICT":
			status = 409
		case "OVER_TARGET", "INSUFFICIENT_BALANCE":
			status = 422
		}
		if status != 500 {
			body = errorDTO{Code: business.Code, Message: business.Message, Field: business.Field}
		}
	}
	c.Set("error_code", body.Code)
	c.Set("error_reason", reason(err))
	respond(c, status, body)
}
func reason(err error) string {
	if errors.Is(err, context.DeadlineExceeded) {
		return "deadline"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	if errors.Is(err, application.ErrCommitUncertain) {
		return "commit_unknown"
	}
	var storage *application.StorageError
	if errors.As(err, &storage) {
		return storage.Kind
	}
	var business *domain.Error
	if errors.As(err, &business) {
		return business.Code
	}
	return "internal"
}
