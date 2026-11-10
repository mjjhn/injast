package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	"injast/hadaf/internal/infrastructure/observability"
	"injast/hadaf/internal/interfaces/httpapi"
	"io/fs"
	"log/slog"
	sqlitedriver "modernc.org/sqlite"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type failureEvents struct {
	mu     sync.Mutex
	events []application.StorageDiagnostic
}

func (f *failureEvents) StorageFailure(_ context.Context, d application.StorageDiagnostic) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, d)
}
func (f *failureEvents) values() []application.StorageDiagnostic {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]application.StorageDiagnostic(nil), f.events...)
}
func TestStorageClassificationsAndCauseIdentity(t *testing.T) {
	for _, tc := range []struct {
		err  error
		want string
	}{{context.Canceled, "canceled"}, {context.DeadlineExceeded, "deadline"}, {sql.ErrConnDone, "closed"}, {fs.ErrPermission, "io"}, {errors.New("private unknown"), "unknown"}, {&json.SyntaxError{}, "corrupt"}} {
		kind, _ := classify(tc.err)
		if kind != tc.want {
			t.Fatal(kind, tc.want)
		}
	}
	// Real driver constraint and syntax errors; no driver structs fabricated.
	for _, tc := range []struct{ sql, kind string }{{"INSERT INTO wallet VALUES(1,1)", "constraint"}, {"not SQL", "unknown"}} {
		s := testStore(t)
		_, cause := s.db.Exec(tc.sql)
		events := &failureEvents{}
		r := reporter{observer: events}
		err := r.commitFailure(ctx, cause)
		var stored *application.StorageError
		var driver *sqlitedriver.Error
		if !errors.Is(err, application.ErrCommitUncertain) || !errors.Is(err, cause) || !errors.As(err, &stored) || !errors.As(err, &driver) {
			t.Fatal("cause identity lost", err)
		}
		if stored.Kind != tc.kind || stored.DriverCode != driver.Code() || stored.Stage != "commit" || len(events.values()) != 1 {
			t.Fatal(stored, events.values())
		}
		r.fail(ctx, "other", "other", err)
		if len(events.values()) != 1 {
			t.Fatal("counted twice")
		}
	}
	events := &failureEvents{}
	r := reporter{observer: events}
	if r.fail(ctx, "goal_get", "scan", domain.NotFound()) == nil {
		t.Fatal("business error swallowed")
	}
	if r.fail(ctx, "goal_get", "scan", nil) != nil || len(events.values()) != 0 {
		t.Fatal("business/success counted")
	}
}
func TestStorageFailureReadWriteHTTPAndRedaction(t *testing.T) {
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, nil))
	telemetry := observability.New(logger, nil)
	s, err := Open(filepath.Join(t.TempDir(), "private-db.db"), time.Now, telemetry)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	service := application.New(s, s, nil, nil, telemetry)
	h := httpapi.New(service, service, httpapi.Options{Logger: logger, Metrics: telemetry})
	// A driver cause containing private text must never reach logs or public errors.
	mustExec(t, s.writer, "CREATE TRIGGER fail_private BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT,'PRIVATE_SQL_AND_KEY_555'); END")
	req := httptest.NewRequest("POST", "/api/goals/book/deposits?private=query", strings.NewReader(`{"amount":12345}`))
	req.Header.Set("Idempotency-Key", "PRIVATE_RAW_KEY_123")
	req.Header.Set("X-Request-ID", "storage-test")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 500 || !strings.Contains(w.Body.String(), `"code":"INTERNAL"`) {
		t.Fatal(w.Code, w.Body)
	}
	before, _ := s.Wallet(ctx)
	if before.AvailableAmount != 25000000 {
		t.Fatal("partial write")
	}
	if strings.Count(logs.String(), `"msg":"storage_failed"`) != 1 {
		t.Fatal("duplicate propagation", logs.String())
	}
	mustExec(t, s.writer, "DROP TRIGGER fail_private")
	// Expected business rejection and normal rollback add no storage events.
	if _, err := service.Deposit(ctx, "book", "over", 999999); err == nil {
		t.Fatal("expected rule failure")
	}
	if _, err := s.Goal(ctx, "missing"); err == nil {
		t.Fatal("missing goal")
	}
	s.reader.Close()
	for _, path := range []string{"/api/wallet", "/api/goals?status=active", "/api/goals/book"} {
		w = httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 500 {
			t.Fatal(path, w.Code)
		}
	}
	if s.Ready(ctx) == nil {
		t.Fatal("closed readiness")
	}
	var draining atomic.Bool
	metrics := httptest.NewRecorder()
	telemetry.OpsHandler(func(context.Context) error { return nil }, &draining).ServeHTTP(metrics, httptest.NewRequest("GET", "/metrics", nil))
	for _, want := range []string{
		`hadaf_storage_errors_total{operation="outcome_save",reason="constraint",stage="execute"} 1`,
		`hadaf_storage_errors_total{operation="wallet_get",reason="closed",stage="scan"} 1`,
		`hadaf_storage_errors_total{operation="goal_list",reason="closed",stage="query"} 1`,
		`hadaf_storage_errors_total{operation="goal_get",reason="closed",stage="scan"} 1`,
		`hadaf_storage_errors_total{operation="readiness",reason="closed",stage="ping"} 1`,
	} {
		if !strings.Contains(metrics.Body.String(), want) {
			t.Fatal("missing metric", want, metrics.Body.String())
		}
	}
	for _, secret := range []string{"PRIVATE_SQL_AND_KEY_555", "PRIVATE_RAW_KEY_123", "private-db.db", "private=query", `"amount":12345`} {
		if strings.Contains(logs.String(), secret) || strings.Contains(w.Body.String(), secret) || strings.Contains(metrics.Body.String(), secret) {
			t.Fatal("leaked", secret)
		}
	}
	var count int
	for _, line := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		var record map[string]any
		if json.Unmarshal([]byte(line), &record) != nil {
			t.Fatal(line)
		}
		if record["msg"] == "storage_failed" {
			count++
			if record["operation"] == "outcome_save" && (record["sqlite_code"] == nil || record["request_id"] != "storage-test") {
				t.Fatal(record)
			}
		}
	}
	if count != 5 {
		t.Fatal("storage count", count)
	}
}
func TestStorageBoundarySpecialFailures(t *testing.T) {
	events := &failureEvents{}
	s, err := Open(filepath.Join(t.TempDir(), "db"), nil, events)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	mustExec(t, s.writer, "INSERT INTO idempotency VALUES('broken','book',1,x'ff')")
	_, _, err = s.Outcome(ctx, "broken")
	var stored *application.StorageError
	if !errors.As(err, &stored) || stored.Kind != "corrupt" || stored.Operation != "outcome_get" || stored.Stage != "decode" {
		t.Fatal(err)
	}
	canceled, cancel := context.WithCancel(ctx)
	cancel()
	if err = s.WithinWriteTx(canceled, func(application.Repositories) error { t.Fatal("unexpected callback"); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	tx, _ := s.writer.BeginTx(ctx, nil)
	tx.Rollback()
	s.reporter.rollback(ctx, tx)
	if len(events.values()) != 2 {
		t.Fatal("normal rollback counted", events.values())
	}
	// Opening an unusable DB reports exactly one physical failure, including migration.
	bad := &failureEvents{}
	db, err := Open(t.TempDir(), nil, bad)
	if err == nil {
		db.Close()
		t.Fatal("directory accepted")
	}
	if len(bad.values()) != 1 {
		t.Fatal("open counted twice", bad.values())
	}
}

func TestActualBusyAndCorruptDriverDiagnostics(t *testing.T) {
	path := filepath.Join(t.TempDir(), "locked.db")
	a, err := Open(path, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	events := &failureEvents{}
	b, err := Open(path, nil, events)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	lock, err := a.writer.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer lock.Rollback()
	err = b.WithinWriteTx(ctx, func(application.Repositories) error { t.Fatal("busy writer entered callback"); return nil })
	var stored *application.StorageError
	if !errors.As(err, &stored) || stored.Kind != "busy" || stored.DriverCode&255 != 5 || stored.Operation != "transaction" || stored.Stage != "begin" {
		t.Fatal("busy diagnostic", err)
	}
	if len(events.values()) != 1 {
		t.Fatal(events.values())
	}
	corrupt := filepath.Join(t.TempDir(), "corrupt.db")
	if err := os.WriteFile(corrupt, []byte("PRIVATE_NOT_A_DATABASE_PAYLOAD"), 0600); err != nil {
		t.Fatal(err)
	}
	failures := &failureEvents{}
	if s, err := Open(corrupt, nil, failures); err == nil {
		s.Close()
		t.Fatal("corrupt DB opened")
	}
	values := failures.values()
	if len(values) != 1 || values[0].Kind != "corrupt" || values[0].DriverCode&255 != 26 {
		t.Fatal("corrupt driver diagnostic", values)
	}
}
