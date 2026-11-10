package observability

import (
	"context"
	"database/sql"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/platform/requestid"
	"log/slog"
	"net/http"
	"strconv"
	"sync/atomic"
	"time"
)

type Telemetry struct {
	registry      *prometheus.Registry
	logger        *slog.Logger
	requests      *prometheus.CounterVec
	duration      *prometheus.HistogramVec
	operations    *prometheus.CounterVec
	failures      *prometheus.CounterVec
	storageErrors *prometheus.CounterVec
}

func New(logger *slog.Logger, stats func() map[string]sql.DBStats) *Telemetry {
	t := &Telemetry{registry: prometheus.NewRegistry(), logger: logger}
	t.requests = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "hadaf_http_requests_total", Help: "Completed API requests."}, []string{"method", "route", "status"})
	t.duration = prometheus.NewHistogramVec(prometheus.HistogramOpts{Name: "hadaf_http_request_duration_seconds", Help: "API request duration in seconds.", Buckets: []float64{.001, .005, .01, .025, .05, .1, .25, .5, 1, 2.5, 5, 10}}, []string{"method", "route"})
	t.operations = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "hadaf_operations_total", Help: "Use case outcomes after transaction completion."}, []string{"operation", "outcome"})
	t.failures = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "hadaf_operation_errors_total", Help: "Rejected or uncertain use cases by bounded reason."}, []string{"operation", "reason"})
	t.storageErrors = prometheus.NewCounterVec(prometheus.CounterOpts{Name: "hadaf_storage_errors_total", Help: "Physical storage failures counted once at the SQLite boundary."}, []string{"operation", "stage", "reason"})
	t.registry.MustRegister(t.storageErrors, t.requests, t.duration, t.operations, t.failures, collectors.NewGoCollector(), collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}))
	if stats != nil {
		for _, pool := range []string{"reader", "writer"} {
			t.registry.MustRegister(prometheus.NewGaugeFunc(prometheus.GaugeOpts{Name: "hadaf_db_connections_in_use", Help: "Connections currently in use.", ConstLabels: prometheus.Labels{"pool": pool}}, func() float64 { return float64(stats()[pool].InUse) }))
			t.registry.MustRegister(prometheus.NewCounterFunc(prometheus.CounterOpts{Name: "hadaf_db_pool_wait_total", Help: "Connection pool waits.", ConstLabels: prometheus.Labels{"pool": pool}}, func() float64 { return float64(stats()[pool].WaitCount) }))
			t.registry.MustRegister(prometheus.NewCounterFunc(prometheus.CounterOpts{Name: "hadaf_db_pool_wait_seconds_total", Help: "Time waiting for a connection.", ConstLabels: prometheus.Labels{"pool": pool}}, func() float64 { return stats()[pool].WaitDuration.Seconds() }))
		}
	}
	return t
}
func (t *Telemetry) HTTP(method, route string, status int, duration time.Duration) {
	switch method {
	case "GET", "POST", "HEAD", "OPTIONS":
	default:
		method = "OTHER"
	}
	switch route {
	case "/api/wallet", "/api/goals", "/api/goals/:id", "/api/goals/:id/deposits", "/api/goals/:id/cancel", "/api/reset":
	default:
		route = "unmatched"
	}
	t.requests.WithLabelValues(method, route, strconv.Itoa(status)).Inc()
	t.duration.WithLabelValues(method, route).Observe(duration.Seconds())
}
func (t *Telemetry) Operation(ctx context.Context, event application.Event) {
	switch event.Name {
	case "create", "deposit", "cancel", "reset":
	default:
		event.Name = "other"
	}
	switch event.Outcome {
	case "committed", "replayed", "rejected", "uncertain":
	default:
		event.Outcome = "other"
	}
	switch event.Reason {
	case "", "VALIDATION", "NOT_FOUND", "NOT_ALLOWED", "IDEMPOTENCY_CONFLICT", "MISSING_IDEMPOTENCY_KEY", "OVER_TARGET", "INSUFFICIENT_BALANCE", "INVALID_STATE", "busy", "storage", "constraint", "io", "corrupt", "closed", "unknown", "commit_unknown", "deadline", "canceled":
	default:
		event.Reason = "storage"
	}
	t.operations.WithLabelValues(event.Name, event.Outcome).Inc()
	level := slog.LevelInfo
	if event.Reason != "" {
		t.failures.WithLabelValues(event.Name, event.Reason).Inc()
		level = slog.LevelWarn
	}
	if event.Outcome == "uncertain" || event.Reason == "storage" {
		level = slog.LevelError
	}
	t.logger.LogAttrs(ctx, level, "operation_finished", slog.String("request_id", requestid.From(ctx)), slog.String("operation", event.Name), slog.String("outcome", event.Outcome), slog.String("reason", event.Reason), slog.String("key_hash", event.KeyHash), slog.Float64("duration_ms", float64(event.Duration.Microseconds())/1000))
}
func (t *Telemetry) OpsHandler(ready func(context.Context) error, draining *atomic.Bool) http.Handler {
	mux := http.NewServeMux()
	var last atomic.Int32
	last.Store(-1)
	mux.HandleFunc("GET /health/live", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("{\"status\":\"ok\"}\n"))
	})
	mux.HandleFunc("GET /health/ready", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 250*time.Millisecond)
		defer cancel()
		err := ready(ctx)
		available := err == nil && !draining.Load()
		state := int32(0)
		if available {
			state = 1
		}
		if previous := last.Swap(state); previous != state {
			t.logger.InfoContext(ctx, "readiness_changed", "ready", available)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Cache-Control", "no-store")
		if !available {
			w.WriteHeader(503)
			w.Write([]byte("{\"status\":\"unavailable\"}\n"))
			return
		}
		w.Write([]byte("{\"status\":\"ready\"}\n"))
	})
	mux.Handle("GET /metrics", promhttp.HandlerFor(t.registry, promhttp.HandlerOpts{}))
	return mux
}

var _ application.Observer = (*Telemetry)(nil)

func (t *Telemetry) StorageFailure(ctx context.Context, d application.StorageDiagnostic) {
	switch d.Operation {
	case "goal_get", "goal_list", "wallet_get", "outcome_get", "goal_add", "goal_save", "goal_delete", "goal_clear", "wallet_save", "outcome_save", "outcome_clear", "transaction", "migration", "readiness", "open":
	default:
		d.Operation = "unknown"
	}
	switch d.Stage {
	case "begin", "query", "scan", "execute", "encode", "decode", "rows", "commit", "rollback", "ping", "open":
	default:
		d.Stage = "unknown"
	}
	switch d.Kind {
	case "busy", "constraint", "io", "corrupt", "closed", "canceled", "deadline", "unknown":
	default:
		d.Kind = "unknown"
	}
	t.storageErrors.WithLabelValues(d.Operation, d.Stage, d.Kind).Inc()
	attrs := []slog.Attr{slog.String("request_id", requestid.From(ctx)), slog.String("operation", d.Operation), slog.String("stage", d.Stage), slog.String("reason", d.Kind)}
	if d.DriverCode != 0 {
		attrs = append(attrs, slog.Int("sqlite_code", d.DriverCode))
	}
	t.logger.LogAttrs(ctx, slog.LevelError, "storage_failed", attrs...)
}

var _ application.StorageObserver = (*Telemetry)(nil)
