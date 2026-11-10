package httpapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"github.com/gin-gonic/gin"
	"injast/hadaf/internal/domain"
	"injast/hadaf/internal/platform/requestid"
	"log/slog"
	"strings"
	"time"
)

func validRequestID(id string) bool {
	if len(id) < 1 || len(id) > 64 {
		return false
	}
	for _, r := range id {
		if !(r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
			return false
		}
	}
	return true
}
func middleware(options Options) gin.HandlerFunc {
	allowed := map[string]bool{}
	for _, origin := range options.Origins {
		allowed[strings.TrimSpace(origin)] = true
	}
	return func(c *gin.Context) {
		start := time.Now()
		id := c.GetHeader("X-Request-ID")
		if !validRequestID(id) {
			var data [16]byte
			if _, err := rand.Read(data[:]); err != nil {
				id = fmt.Sprintf("request-%d", time.Now().UnixNano())
			} else {
				id = hex.EncodeToString(data[:])
			}
		}
		ctx, cancel := context.WithTimeout(requestid.With(c.Request.Context(), id), options.RequestTimeout)
		defer cancel()
		c.Request = c.Request.WithContext(ctx)
		c.Header("X-Request-ID", id)
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Header("Cache-Control", "no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		c.Writer.Header().Add("Vary", "Origin")
		defer func() {
			if recovered := recover(); recovered != nil {
				options.Logger.ErrorContext(ctx, "panic_recovered", "request_id", id, "panic_type", fmt.Sprintf("%T", recovered))
				if !c.Writer.Written() {
					writeError(c, fmt.Errorf("handler panic"))
				}
				c.Abort()
			}
			route := c.FullPath()
			if route == "" {
				route = "unmatched"
			}
			elapsed := time.Since(start)
			status := c.Writer.Status()
			level := slog.LevelInfo
			if status >= 500 {
				level = slog.LevelError
			} else if status >= 400 {
				level = slog.LevelWarn
			}
			options.Logger.LogAttrs(ctx, level, "request_finished", slog.String("request_id", id), slog.String("method", c.Request.Method), slog.String("route", route), slog.Int("status", status), slog.Float64("duration_ms", float64(elapsed.Microseconds())/1000), slog.Any("error_code", c.GetString("error_code")), slog.Any("reason", c.GetString("error_reason")), slog.Bool("write_failed", c.GetBool("write_failed")))
			if options.Metrics != nil {
				options.Metrics.HTTP(c.Request.Method, route, status, elapsed)
			}
		}()
		origin := c.GetHeader("Origin")
		if origin != "" {
			if !allowed[origin] {
				writeError(c, domain.Validation("", "مبدأ درخواست مجاز نیست."))
				c.Abort()
				return
			}
			c.Header("Access-Control-Allow-Origin", origin)
			c.Header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
			c.Header("Access-Control-Allow-Headers", "Content-Type, Idempotency-Key, X-Request-ID")
			c.Header("Access-Control-Expose-Headers", "X-Request-ID")
		}
		if c.Request.Method == "OPTIONS" {
			c.Status(204)
			c.Abort()
			return
		}
		c.Next()
	}
}
