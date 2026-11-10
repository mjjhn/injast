package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestStrictJSONRegression(t *testing.T) {
	h := setup(t)
	for _, body := range []string{
		`{"amount":1,"amount":null}`, `{"amount":1,"\u0061mount":2}`,
		`{"amount":1,"Amount":2}`, `{"amount":1,"extra":1}`, `{"amount":true}`,
		`null`, `[]`, `1`, `"amount"`, `{"amount":1} null`, `{"amount":1e3}`,
		`{"amount":1,}`, `{"amount":{}}`, `{"amount":[]}`, "{\"amount\":1,\"bad\":\"\xff\"}",
		`{"amount":` + strings.Repeat("1", 1<<20) + `}`,
	} {
		w := call(h, "POST", "/api/goals/book/deposits", body, "strict")
		if w.Code != 400 {
			t.Fatalf("accepted malformed input %d %.100s", w.Code, body)
		}
	}
	w := call(h, "POST", "/api/goals", `{"name":"test","targetAmount":500000,"deadline":"2027-02-01","fundingSource":"wallet","acceptedTerms":true,"acceptedTerms":null}`, "")
	if w.Code != 400 {
		t.Fatal(w.Code, w.Body)
	}
	w = call(h, "GET", "/api/wallet", "", "")
	if !strings.Contains(w.Body.String(), "25000000") {
		t.Fatal("malformed input changed wallet")
	}
	for _, path := range []string{"/api/wallet/", "/API/wallet", "/api//wallet"} {
		w := call(h, "GET", path, "", "")
		if w.Code != 404 || w.Header().Get("Location") != "" {
			t.Fatal("redirect enabled", path, w.Code)
		}
	}
}

type failingService struct {
	err        error
	panicValue any
	wait       bool
}

func (f failingService) fail(ctx context.Context) error {
	if f.panicValue != nil {
		panic(f.panicValue)
	}
	if f.wait {
		<-ctx.Done()
		return ctx.Err()
	}
	return f.err
}
func (f failingService) Goal(ctx context.Context, _ string) (domain.Goal, error) {
	return domain.Goal{}, f.fail(ctx)
}
func (f failingService) List(ctx context.Context, _ domain.Status) ([]domain.Goal, error) {
	return nil, f.fail(ctx)
}
func (f failingService) Wallet(ctx context.Context) (domain.Wallet, error) {
	return domain.Wallet{}, f.fail(ctx)
}
func (f failingService) Create(ctx context.Context, _ domain.CreateInput) (domain.Goal, error) {
	return domain.Goal{}, f.fail(ctx)
}
func (f failingService) Deposit(ctx context.Context, _, _ string, _ domain.Money) (application.Receipt, error) {
	return application.Receipt{}, f.fail(ctx)
}
func (f failingService) Cancel(ctx context.Context, _ string) (domain.Wallet, error) {
	return domain.Wallet{}, f.fail(ctx)
}
func (f failingService) Reset(ctx context.Context) error { return f.fail(ctx) }

type metricSpy struct{ calls int }

func (m *metricSpy) HTTP(string, string, int, time.Duration) { m.calls++ }
func TestFailureMappingRecoveryDeadlineAndPrivateLogs(t *testing.T) {
	for _, service := range []failingService{{err: errors.New("secret SQL private-name 987654")}, {panicValue: "private panic body"}, {wait: true}, {err: context.Canceled}, {err: application.ErrCommitUncertain}, {err: &application.StorageError{Kind: "busy", Err: errors.New("private SQL")}}} {
		var logs bytes.Buffer
		m := &metricSpy{}
		h := New(service, service, Options{Logger: slog.New(slog.NewJSONHandler(&logs, nil)), Metrics: m, RequestTimeout: time.Millisecond})
		for _, path := range []string{"/api/wallet?secret=raw", "/api/goals?status=active", "/api/goals/id"} {
			req := httptest.NewRequest("GET", path, nil)
			req.Header.Set("X-Request-ID", "safe_request-1")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, req)
			if w.Code != 500 || !strings.Contains(w.Body.String(), `"code":"INTERNAL"`) || w.Header().Get("X-Request-ID") != "safe_request-1" {
				t.Fatal(w.Code, w.Body, w.Header())
			}
		}
		for _, tc := range []struct{ path, body, key string }{{"/api/reset", "{}", ""}, {"/api/goals/id/cancel", "{}", ""}, {"/api/goals/id/deposits", `{"amount":1}`, "raw-key"}, {"/api/goals", `{"name":"private-name","targetAmount":500000,"deadline":"2027-02-01","fundingSource":"wallet","acceptedTerms":true}`, ""}} {
			w := call(h, "POST", tc.path, tc.body, tc.key)
			if w.Code != 500 {
				t.Fatal(w.Code, w.Body)
			}
		}
		if m.calls != 7 {
			t.Fatal(m.calls)
		}
		for _, secret := range []string{"private-name", "private panic body", "987654", "secret=raw", "raw-key", "private SQL"} {
			if strings.Contains(logs.String(), secret) {
				t.Fatal("private logs", secret)
			}
		}
		dec := json.NewDecoder(&logs)
		for {
			var record map[string]any
			err := dec.Decode(&record)
			if err == io.EOF {
				break
			}
			if err != nil || record["msg"] == nil {
				t.Fatal(err, record)
			}
		}
	}
}
func TestRequestIDAndLongKeyCompatibility(t *testing.T) {
	h := setup(t)
	for _, id := range []string{"bad id", "", strings.Repeat("x", 65)} {
		r := httptest.NewRequest("GET", "/api/wallet", nil)
		r.Header.Set("X-Request-ID", id)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if !validRequestID(w.Header().Get("X-Request-ID")) {
			t.Fatal(w.Header())
		}
	}
	key := strings.Repeat("a", 257)
	first := call(h, "POST", "/api/goals/book/deposits", `{"amount":1}`, key)
	replay := call(h, "POST", "/api/goals/book/deposits", `{"amount":1}`, key)
	if first.Code != 200 || replay.Code != 200 || first.Body.String() != replay.Body.String() {
		t.Fatal("brief does not impose a new key-length restriction", first.Code, replay.Code)
	}
}
func FuzzStrictJSON(f *testing.F) {
	for _, s := range []string{`{"amount":123}`, `{"amount":1,"amount":null}`, `[]`, `{"amount":1.2}`} {
		f.Add(s)
	}
	f.Fuzz(func(t *testing.T, s string) {
		if len(s) > 1<<20 {
			t.Skip()
		}
		var body struct {
			Amount domain.Money `json:"amount"`
		}
		r := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(s))
		w := httptest.NewRecorder()
		if decode(w, r, &body, "amount") == nil {
			var x map[string]json.RawMessage
			if json.Unmarshal([]byte(s), &x) != nil || len(x) > 1 || (len(x) == 1 && x["amount"] == nil) {
				t.Fatal("invalid success")
			}
		}
	})
}
