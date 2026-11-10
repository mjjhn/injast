package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"injast/hadaf/internal/application"
	goals "injast/hadaf/internal/domain"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

var ctx = context.Background()

func testStore(t *testing.T) *testStoreHandle {
	t.Helper()
	s, err := openTest(filepath.Join(t.TempDir(), "goals.db"), func() time.Time { return time.Date(2026, 11, 9, 12, 0, 0, 0, goals.Tehran) })
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}
func assertCode(t *testing.T, err error, code string) {
	t.Helper()
	var e *goals.Error
	if !errors.As(err, &e) || e.Code != code {
		t.Fatalf("want %s got %v", code, err)
	}
}
func balance(t *testing.T, s *testStoreHandle) int64 {
	t.Helper()
	w, err := s.Wallet(ctx)
	if err != nil {
		t.Fatal(err)
	}
	return int64(w.AvailableAmount)
}
func total(t *testing.T, s *testStoreHandle) int64 {
	t.Helper()
	sum := balance(t, s)
	for _, status := range []string{"active", "completed"} {
		list, err := s.List(ctx, goals.Status(status))
		if err != nil {
			t.Fatal(err)
		}
		for _, g := range list {
			sum += int64(g.SavedAmount)
		}
	}
	return sum
}
func TestSeedAndCreate(t *testing.T) {
	s := testStore(t)
	if balance(t, s) != 25000000 || total(t, s) != 54500000 {
		t.Fatal("seed amounts")
	}
	list, _ := s.List(ctx, "completed")
	if list == nil || len(list) != 0 {
		t.Fatal("empty list must encode as []")
	}
	g, err := s.Create(ctx, goals.CreateInput{Name: "  دوچرخه  ", TargetAmount: 10000000, Deadline: "2027-02-01", FundingSource: "monthly", AcceptedTerms: true})
	if err != nil {
		t.Fatal(err)
	}
	if g.Name != "دوچرخه" || g.SavedAmount != 0 || g.Status != "active" || g.ID == "" {
		t.Fatal(g)
	}
	if total(t, s) != 54500000 {
		t.Fatal("create changed money")
	}
}
func TestFailedDepositDoesNotChangeMoney(t *testing.T) {
	for _, tc := range []struct {
		name, id, key string
		amount        int64
		code          string
	}{{"over", "book", "over", 600000, "OVER_TARGET"}, {"poor", "laptop", "poor", 30000000, "INSUFFICIENT_BALANCE"}, {"zero", "book", "zero", 0, "VALIDATION"}, {"negative", "book", "negative", -1, "VALIDATION"}, {"key", "book", "", 1000, "MISSING_IDEMPOTENCY_KEY"}, {"missing", "missing", "missing", 1000, "NOT_FOUND"}} {
		t.Run(tc.name, func(t *testing.T) {
			s := testStore(t)
			_, err := s.Deposit(ctx, tc.id, tc.key, tc.amount)
			assertCode(t, err, tc.code)
			if balance(t, s) != 25000000 || total(t, s) != 54500000 {
				t.Fatal("failed mutation changed money")
			}
		})
	}
}
func TestCompletionReplayAndConflicts(t *testing.T) {
	s := testStore(t)
	raw, err := s.Deposit(ctx, "book", "finish", 500000)
	if err != nil {
		t.Fatal(err)
	}
	var result goals.DepositResult
	if err = json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if result.Goal.Status != "completed" || result.Wallet.AvailableAmount != 24500000 {
		t.Fatal(result)
	}
	replay, err := s.Deposit(ctx, "book", "finish", 500000)
	if err != nil || !bytes.Equal(raw, replay) {
		t.Fatal("replay must be identical", err)
	}
	_, err = s.Deposit(ctx, "book", "finish", 1000)
	assertCode(t, err, "IDEMPOTENCY_CONFLICT")
	_, err = s.Deposit(ctx, "trip", "finish", 500000)
	assertCode(t, err, "IDEMPOTENCY_CONFLICT")
	_, err = s.Deposit(ctx, "book", "new-key", 1000)
	assertCode(t, err, "NOT_ALLOWED")
	_, err = s.Cancel(ctx, "book")
	assertCode(t, err, "NOT_ALLOWED")
	if balance(t, s) != 24500000 || total(t, s) != 54500000 {
		t.Fatal("duplicate debit or broken invariant")
	}
}
func TestHistoricalReplayAfterOtherWritesAndDeletion(t *testing.T) {
	s := testStore(t)
	first, err := s.Deposit(ctx, "trip", "trip-one", 1000)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Deposit(ctx, "laptop", "later", 2000); err != nil {
		t.Fatal(err)
	}
	w, err := s.Cancel(ctx, "trip")
	if err != nil {
		t.Fatal(err)
	}
	if w.AvailableAmount != 32998000 {
		t.Fatal(w)
	}
	_, err = s.Goal(ctx, "trip")
	assertCode(t, err, "NOT_FOUND")
	_, err = s.Cancel(ctx, "trip")
	assertCode(t, err, "NOT_FOUND")
	replay, err := s.Deposit(ctx, "trip", "trip-one", 1000)
	if err != nil || !bytes.Equal(first, replay) {
		t.Fatal("deleted goal replay failed", err)
	}
	if balance(t, s) != 32998000 || total(t, s) != 54500000 {
		t.Fatal("replay mutated latest wallet")
	}
}
func TestRestartAndReset(t *testing.T) {
	path := filepath.Join(t.TempDir(), "goals.db")
	s, err := openTest(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	first, err := s.Deposit(ctx, "book", "persist", 500000)
	if err != nil {
		t.Fatal(err)
	}
	if err = s.Close(); err != nil {
		t.Fatal(err)
	}
	s, err = openTest(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	replay, err := s.Deposit(ctx, "book", "persist", 500000)
	if err != nil || !bytes.Equal(first, replay) || balance(t, s) != 24500000 {
		t.Fatal("restart lost state", err)
	}
	if err = s.Reset(ctx); err != nil {
		t.Fatal(err)
	}
	if balance(t, s) != 25000000 {
		t.Fatal("reset balance")
	}
	if _, err = s.Deposit(ctx, "book", "persist", 500000); err != nil {
		t.Fatal("reset did not clear key", err)
	}
	if balance(t, s) != 24500000 {
		t.Fatal("reset replay did not perform new deposit")
	}
}
func TestPersistenceFailureRollsBackEveryWrite(t *testing.T) {
	s := testStore(t)
	_, err := s.db.Exec("CREATE TRIGGER fail_outcome BEFORE INSERT ON idempotency BEGIN SELECT RAISE(ABORT,'test injected failure'); END;")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = s.Deposit(ctx, "book", "atomic", 500000); err == nil {
		t.Fatal("expected storage failure")
	}
	g, _ := s.Goal(ctx, "book")
	if balance(t, s) != 25000000 || g.SavedAmount != 1500000 || g.Status != "active" {
		t.Fatal("partial mutation survived rollback")
	}
	if _, err = s.db.Exec("DROP TRIGGER fail_outcome"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Deposit(ctx, "book", "atomic", 500000); err != nil {
		t.Fatal("failed transaction reserved key", err)
	}
}
func concurrent(t *testing.T, n int, fn func(int) error) []error {
	t.Helper()
	errs := make([]error, n)
	start := make(chan struct{})
	var wg sync.WaitGroup
	for i := range n {
		wg.Add(1)
		go func() { defer wg.Done(); <-start; errs[i] = fn(i) }()
	}
	close(start)
	wg.Wait()
	return errs
}
func TestConcurrentSameKeyAcrossTwoStores(t *testing.T) {
	path := filepath.Join(t.TempDir(), "goals.db")
	a, err := openTest(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	b, err := openTest(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	responses := make([]json.RawMessage, 20)
	errs := concurrent(t, 20, func(i int) error {
		s := a
		if i%2 != 0 {
			s = b
		}
		var err error
		responses[i], err = s.Deposit(ctx, "book", "same", 500000)
		return err
	})
	for i, err := range errs {
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(responses[0], responses[i]) {
			t.Fatal("inconsistent replay")
		}
	}
	if balance(t, a) != 24500000 || total(t, a) != 54500000 {
		t.Fatal("double debit")
	}
}
func TestConcurrentDifferentKeysCannotOverdrawOrOverfill(t *testing.T) {
	for _, tc := range []struct {
		name, id string
		amount   int64
		n, want  int
		wallet   int64
	}{{"wallet", "laptop", 500000, 70, 50, 0}, {"target", "book", 100000, 10, 5, 24500000}} {
		t.Run(tc.name, func(t *testing.T) {
			s := testStore(t)
			errs := concurrent(t, tc.n, func(i int) error { _, err := s.Deposit(ctx, tc.id, fmt.Sprint(i), tc.amount); return err })
			ok := 0
			for _, err := range errs {
				if err == nil {
					ok++
					continue
				}
				var e *goals.Error
				if !errors.As(err, &e) {
					t.Fatal(err)
				}
			}
			if ok != tc.want || balance(t, s) != tc.wallet || total(t, s) != 54500000 {
				t.Fatalf("success=%d wallet=%d total=%d", ok, balance(t, s), total(t, s))
			}
		})
	}
}
func TestCancelDepositRaceConservesMoney(t *testing.T) {
	s := testStore(t)
	errs := concurrent(t, 2, func(i int) error {
		if i == 0 {
			_, err := s.Deposit(ctx, "trip", "race", 1000)
			return err
		}
		_, err := s.Cancel(ctx, "trip")
		return err
	})
	if errs[1] != nil {
		t.Fatal(errs[1])
	}
	if errs[0] != nil {
		assertCode(t, errs[0], "NOT_FOUND")
	}
	if balance(t, s) != 33000000 || total(t, s) != 54500000 {
		t.Fatal("race created or lost money")
	}
}

type testStoreHandle struct {
	db    *sql.DB
	store *Store
	*application.Service
}

func openTest(path string, clock func() time.Time) (*testStoreHandle, error) {
	s, err := Open(path, clock)
	if err != nil {
		return nil, err
	}
	return &testStoreHandle{db: s.writer, store: s, Service: application.New(s, s, clock, func() (string, error) { return "created-goal", nil }, nil)}, nil
}
func (s *testStoreHandle) Close() error { return s.store.Close() }
func (s *testStoreHandle) Deposit(ctx context.Context, id, key string, amount int64) (json.RawMessage, error) {
	receipt, err := s.Service.Deposit(ctx, id, key, goals.Money(amount))
	if err != nil {
		return nil, err
	}
	return encodeSnapshot(receipt.Result)
}
