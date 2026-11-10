package observability

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/platform/requestid"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestIndependentRegistryMetricsAndPrivateJSON(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	stats := func() map[string]sql.DBStats {
		return map[string]sql.DBStats{"reader": {InUse: 2, WaitCount: 3, WaitDuration: time.Second}, "writer": {InUse: 1}}
	}
	a, b := New(logger, stats), New(logger, nil)
	a.HTTP("GET", "/api/goals/:id", 200, time.Millisecond)
	a.HTTP("SECRET_METHOD", "/api/goals/private-id", 404, time.Second)
	for _, event := range []application.Event{
		{Name: "deposit", Outcome: "committed", KeyHash: "ab12"}, {Name: "deposit", Outcome: "replayed"},
		{Name: "cancel", Outcome: "rejected", Reason: "NOT_FOUND"}, {Name: "deposit", Outcome: "uncertain", Reason: "commit_unknown"},
		{Name: "private-operation", Outcome: "private-outcome", Reason: "private-reason"},
	} {
		a.Operation(requestid.With(context.Background(), "correlation"), event)
	}
	var draining atomic.Bool
	h := a.OpsHandler(func(context.Context) error { return nil }, &draining)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	if w.Code != 200 {
		t.Fatal(w.Code)
	}
	for _, want := range []string{`hadaf_http_requests_total{method="GET",route="/api/goals/:id",status="200"} 1`, `route="unmatched"`, `method="OTHER"`, `hadaf_operations_total{operation="deposit",outcome="committed"} 1`, `hadaf_db_connections_in_use{pool="reader"} 2`, `hadaf_db_pool_wait_total{pool="reader"} 3`, `go_goroutines`, `process_start_time_seconds`} {
		if !strings.Contains(w.Body.String(), want) {
			t.Fatal("missing metric", want)
		}
	}
	for _, secret := range []string{"private-id", "private-operation", "private-reason", "correlation", "ab12"} {
		if strings.Contains(w.Body.String(), secret) {
			t.Fatal("unbounded label", secret)
		}
	}
	w = httptest.NewRecorder()
	b.OpsHandler(func(context.Context) error { return nil }, &draining).ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	if strings.Contains(w.Body.String(), `outcome="committed"`) {
		t.Fatal("registry leaked")
	}
	for _, line := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		var record map[string]any
		if err := json.Unmarshal([]byte(line), &record); err != nil {
			t.Fatal(err)
		}
		if record["request_id"] != "correlation" {
			t.Fatal(record)
		}
	}
}
func TestHealthAndReadinessTransitions(t *testing.T) {
	var logs bytes.Buffer
	telemetry := New(slog.New(slog.NewJSONHandler(&logs, nil)), nil)
	var draining atomic.Bool
	var fail bool
	h := telemetry.OpsHandler(func(ctx context.Context) error {
		if _, ok := ctx.Deadline(); !ok {
			t.Fatal("no readiness deadline")
		}
		if fail {
			return errors.New("private DB cause")
		}
		return nil
	}, &draining)
	for _, tc := range []struct {
		path             string
		code             int
		broken, draining bool
	}{{"/health/live", 200, false, false}, {"/health/ready", 200, false, false}, {"/health/ready", 200, false, false}, {"/health/ready", 503, true, false}, {"/health/live", 200, true, true}, {"/health/ready", 503, false, true}, {"/health/ready", 200, false, false}} {
		fail = tc.broken
		draining.Store(tc.draining)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", tc.path, nil))
		if w.Code != tc.code {
			t.Fatal(tc, w.Code)
		}
	}
	if strings.Count(logs.String(), "readiness_changed") != 3 || strings.Contains(logs.String(), "private DB cause") {
		t.Fatal(logs.String())
	}
}

func TestStorageMetricDimensionsAreBounded(t *testing.T) {
	var logs bytes.Buffer
	telemetry := New(slog.New(slog.NewJSONHandler(&logs, nil)), nil)
	telemetry.StorageFailure(context.Background(), application.StorageDiagnostic{Operation: "PRIVATE_ID", Stage: "PRIVATE_KEY", Kind: "PRIVATE_BODY", DriverCode: 19})
	var draining atomic.Bool
	w := httptest.NewRecorder()
	telemetry.OpsHandler(func(context.Context) error { return nil }, &draining).ServeHTTP(w, httptest.NewRequest("GET", "/metrics", nil))
	if !strings.Contains(w.Body.String(), `hadaf_storage_errors_total{operation="unknown",reason="unknown",stage="unknown"} 1`) {
		t.Fatal(w.Body)
	}
	if strings.Contains(w.Body.String(), "PRIVATE") || strings.Contains(logs.String(), "PRIVATE") || strings.Contains(w.Body.String(), "sqlite_code") {
		t.Fatal("private/unbounded dimensions")
	}
	if !strings.Contains(logs.String(), `"sqlite_code":19`) {
		t.Fatal("driver code missing from log")
	}
}
