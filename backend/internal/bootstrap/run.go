package bootstrap

import (
	"context"
	"database/sql"
	"errors"
	"github.com/gin-gonic/gin"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/infrastructure/observability"
	"injast/hadaf/internal/infrastructure/sqlite"
	"injast/hadaf/internal/interfaces/httpapi"
	"log/slog"
	"net"
	"net/http"
	"sync/atomic"
	"time"
)

func Run(ctx context.Context, cfg Config, logger *slog.Logger) error {
	logger.Info("startup_begin")
	var store *sqlite.Store
	telemetry := observability.New(logger, func() map[string]sql.DBStats {
		if store == nil {
			return nil
		}
		return store.Stats()
	})
	var err error
	store, err = sqlite.Open(cfg.DBPath, time.Now, telemetry)
	if err != nil {
		return failed("storage_open", err)
	}
	defer store.Close()
	logger.Info("migration_completed", "from_version", store.FromVersion, "to_version", 2)
	usecases := application.New(store, store, time.Now, NewID, telemetry)
	gin.SetMode(gin.ReleaseMode)
	handler := httpapi.New(usecases, usecases, httpapi.Options{Origins: cfg.Origins, Logger: logger, Metrics: telemetry, RequestTimeout: cfg.RequestTimeout})
	apiListener, err := net.Listen("tcp", cfg.APIAddr)
	if err != nil {
		return failed("api_listen", err)
	}
	defer apiListener.Close()
	api := &http.Server{Handler: handler, ReadHeaderTimeout: 5 * time.Second, ReadTimeout: 10 * time.Second, WriteTimeout: 15 * time.Second, IdleTimeout: 60 * time.Second}
	var draining atomic.Bool
	servers := []*http.Server{api}
	listeners := []net.Listener{apiListener}
	if cfg.OpsAddr != "" {
		listener, e := net.Listen("tcp", cfg.OpsAddr)
		if e != nil {
			return failed("ops_listen", e)
		}
		defer listener.Close()
		servers = append(servers, &http.Server{Handler: telemetry.OpsHandler(store.Ready, &draining), ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second})
		listeners = append(listeners, listener)
	}
	failures := make(chan error, len(servers))
	for i, server := range servers {
		go func() { failures <- server.Serve(listeners[i]) }()
	}
	logger.Info("startup_ready", "api_address", apiListener.Addr().String(), "ops_address", cfg.OpsAddr)
	select {
	case <-ctx.Done():
	case err = <-failures:
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
	}
	draining.Store(true)
	logger.Info("shutdown_begin")
	shutdown, cancel := context.WithTimeout(context.Background(), cfg.ShutdownTimeout)
	defer cancel()
	var stopError error
	for _, server := range servers {
		if e := server.Shutdown(shutdown); e != nil {
			stopError = errors.Join(stopError, e)
			server.Close()
		}
	}
	logger.Info("shutdown_complete", "clean", stopError == nil)
	return failed("runtime", errors.Join(err, stopError))
}
