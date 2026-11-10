package httpapi

import (
	"encoding/json"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"

	"injast/hadaf/internal/infrastructure/sqlite"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func setup(t *testing.T) http.Handler {
	t.Helper()
	s, err := sqlite.Open(filepath.Join(t.TempDir(), "goals.db"), func() time.Time { return time.Date(2026, 11, 9, 12, 0, 0, 0, domain.Tehran) })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	service := application.New(s, s, func() time.Time { return time.Date(2026, 11, 9, 12, 0, 0, 0, domain.Tehran) }, func() (string, error) { return "created-goal", nil }, nil)
	return New(service, service, Options{Origins: []string{"http://127.0.0.1:5173"}})
}
func call(h http.Handler, method, path, body, key string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, path, strings.NewReader(body))
	if key != "" {
		r.Header.Set("Idempotency-Key", key)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}
func TestHTTPValidationAndEnvelope(t *testing.T) {
	for _, tc := range []struct {
		name, method, path, body, key string
		status                        int
		code, field                   string
	}{
		{"missing status", "GET", "/api/goals", "", "", 400, "VALIDATION", "status"},
		{"invalid status", "GET", "/api/goals?status=deleted", "", "", 400, "VALIDATION", "status"},
		{"missing goal", "GET", "/api/goals/missing", "", "", 404, "NOT_FOUND", ""},
		{"missing key", "POST", "/api/goals/book/deposits", `{"amount":1}`, "", 400, "MISSING_IDEMPOTENCY_KEY", ""},
		{"fraction", "POST", "/api/goals/book/deposits", `{"amount":1.5}`, "key", 400, "VALIDATION", "amount"},
		{"overflow", "POST", "/api/goals/book/deposits", `{"amount":9223372036854775808}`, "key", 400, "VALIDATION", "amount"},
		{"string", "POST", "/api/goals/book/deposits", `{"amount":"500000"}`, "key", 400, "VALIDATION", "amount"},
		{"null amount", "POST", "/api/goals/book/deposits", `{"amount":null}`, "key", 400, "VALIDATION", "amount"},
		{"bad json", "POST", "/api/goals/book/deposits", `{`, "key", 400, "VALIDATION", ""},
		{"trailing json", "POST", "/api/goals/book/deposits", `{"amount":1}{}`, "key", 400, "VALIDATION", ""},
		{"over target", "POST", "/api/goals/book/deposits", `{"amount":600000}`, "key", 422, "OVER_TARGET", "amount"},
		{"poor", "POST", "/api/goals/laptop/deposits", `{"amount":30000000}`, "key", 422, "INSUFFICIENT_BALANCE", "amount"},
		{"target type", "POST", "/api/goals", `{"targetAmount":1.5}`, "", 400, "VALIDATION", "targetAmount"},
		{"terms type", "POST", "/api/goals", `{"acceptedTerms":"true"}`, "", 400, "VALIDATION", "acceptedTerms"},
		{"unknown route", "GET", "/unknown", "", "", 404, "NOT_FOUND", ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := setup(t)
			w := call(h, tc.method, tc.path, tc.body, tc.key)
			if w.Code != tc.status {
				t.Fatalf("want %d got %d: %s", tc.status, w.Code, w.Body)
			}
			var e errorDTO
			if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil {
				t.Fatal(err)
			}
			if e.Code != tc.code || e.Field != tc.field || e.Message == "" {
				t.Fatal(w.Body)
			}
			wallet := call(h, "GET", "/api/wallet", "", "")
			if !strings.Contains(wallet.Body.String(), "25000000") {
				t.Fatal("validation mutated money")
			}
		})
	}
}
func TestHTTPHappyPathAndReplay(t *testing.T) {
	h := setup(t)
	created := call(h, "POST", "/api/goals", `{"name":"دوچرخه","targetAmount":10000000,"deadline":"2027-02-01","fundingSource":"monthly","acceptedTerms":true}`, "")
	if created.Code != 201 {
		t.Fatal(created.Body)
	}
	first := call(h, "POST", "/api/goals/book/deposits", `{"amount":500000}`, "finish")
	replay := call(h, "POST", "/api/goals/book/deposits", `{"amount":500000}`, "finish")
	if first.Code != 200 || replay.Code != 200 || first.Body.String() != replay.Body.String() {
		t.Fatal("replay differs")
	}
	conflict := call(h, "POST", "/api/goals/book/deposits", `{"amount":1000}`, "finish")
	if conflict.Code != 409 {
		t.Fatal(conflict.Body)
	}
	for _, path := range []string{"/api/goals/book/cancel", "/api/goals/book/deposits"} {
		w := call(h, "POST", path, `{"amount":1000}`, "fresh")
		if w.Code != 409 {
			t.Fatal(w.Body)
		}
	}
	cancelled := call(h, "POST", "/api/goals/trip/cancel", `{}`, "")
	if cancelled.Code != 200 || !strings.Contains(cancelled.Body.String(), "32500000") {
		t.Fatal(cancelled.Body)
	}
}
func TestPreflightAndActualCORS(t *testing.T) {
	h := setup(t)
	r := httptest.NewRequest("OPTIONS", "/api/goals/book/deposits", nil)
	r.Header.Set("Origin", "http://127.0.0.1:5173")
	r.Header.Set("Access-Control-Request-Method", "POST")
	r.Header.Set("Access-Control-Request-Headers", "content-type,idempotency-key")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 204 || w.Header().Get("Access-Control-Allow-Origin") != "http://127.0.0.1:5173" || !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "Idempotency-Key") {
		t.Fatal(w.Code, w.Header())
	}
	r = httptest.NewRequest("POST", "/api/goals/book/deposits", strings.NewReader(`{"amount":500000}`))
	r.Header.Set("Origin", "http://127.0.0.1:5173")
	r.Header.Set("Idempotency-Key", "cors")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("Access-Control-Allow-Origin") == "" {
		t.Fatal(w.Code, w.Header())
	}
	r = httptest.NewRequest("POST", "/api/reset", nil)
	r.Header.Set("Origin", "https://untrusted.example")
	w = httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 400 || w.Header().Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("untrusted origin accepted")
	}
}
