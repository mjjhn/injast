package sqlite

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func mustExec(t *testing.T, db *sql.DB, q string, args ...any) {
	t.Helper()
	if _, err := db.Exec(q, args...); err != nil {
		t.Fatal(err)
	}
}
func TestV1MigrationPreservesHistoricalBytes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "v1.db")
	db, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, db, schema)
	mustExec(t, db, "PRAGMA user_version=1")
	mustExec(t, db, "INSERT INTO wallet VALUES(1,24999000)")
	mustExec(t, db, "INSERT INTO goals VALUES('old','قدیمی',2000000,1501000,'2027-02-01','wallet','active','2026-11-09T12:00:00Z')")
	raw := []byte(`{"goal":{"id":"old","name":"قدیمی","targetAmount":2000000,"savedAmount":1501000,"deadline":"2027-02-01","fundingSource":"wallet","status":"active","createdAt":"2026-11-09T12:00:00Z"},"wallet":{"availableAmount":24999000}}`)
	mustExec(t, db, "INSERT INTO idempotency VALUES('old-key','old',1000,?)", raw)
	db.Close()
	s, err := openTest(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if s.store.FromVersion != 1 || balance(t, s) != 24999000 {
		t.Fatal("migration changed balance/version")
	}
	replay, err := s.Deposit(ctx, "old", "old-key", 1000)
	if err != nil || !bytes.Equal(replay, raw) {
		t.Fatal("legacy replay changed", err, string(replay))
	}
	var saved []byte
	if err = s.db.QueryRow("SELECT response FROM idempotency").Scan(&saved); err != nil || !bytes.Equal(raw, saved) {
		t.Fatal("BLOB rewritten", err)
	}
	var version int
	s.db.QueryRow("PRAGMA user_version").Scan(&version)
	if version != 2 {
		t.Fatal(version)
	}
	var id, parent, unused int
	var plan string
	if err = s.db.QueryRow("EXPLAIN QUERY PLAN SELECT "+columns+" FROM goals WHERE status=? ORDER BY created_at DESC,id ASC", "active").Scan(&id, &parent, &unused, &plan); err != nil || !strings.Contains(plan, "goals_status_created_id") {
		t.Fatal(plan, err)
	}
}
func TestUnknownSchemaAndAtomicMigration(t *testing.T) {
	for _, version := range []int{0, 99} {
		t.Run(fmt.Sprint(version), func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "fail.db")
			db, _ := sql.Open("sqlite", dsn(path, false))
			defer db.Close()
			mustExec(t, db, schema)
			mustExec(t, db, fmt.Sprintf("PRAGMA user_version=%d", version))
			mustExec(t, db, "INSERT INTO wallet VALUES(1,777)")
			if version == 0 {
				mustExec(t, db, "CREATE TRIGGER fail_seed BEFORE INSERT ON goals BEGIN SELECT RAISE(ABORT,'seed fail'); END")
			}
			if s, err := Open(path, nil); err == nil {
				s.Close()
				t.Fatal("expected startup failure")
			}
			var balance, actual int
			db.QueryRow("SELECT available FROM wallet").Scan(&balance)
			db.QueryRow("PRAGMA user_version").Scan(&actual)
			if balance != 777 || actual != version {
				t.Fatal("partial migration", balance, actual)
			}
		})
	}
	if s, err := Open(t.TempDir(), nil); err == nil {
		s.Close()
		t.Fatal("directory accepted as DB")
	}
}
func TestReadPoolReplayWhileWriterIsLocked(t *testing.T) {
	s := testStore(t)
	original, err := s.Deposit(ctx, "book", "fast", 1000)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	readCtx, cancel := context.WithTimeout(ctx, 300*time.Millisecond)
	defer cancel()
	// This cannot acquire the writer's only connection. Replay must use the read pool.
	receipt, err := s.Service.Deposit(readCtx, "book", "fast", 1000)
	if err != nil || !receipt.Replayed {
		t.Fatal("replay blocked on writer", err)
	}
	actual, _ := encodeSnapshot(receipt.Result)
	if !bytes.Equal(actual, original) {
		t.Fatal("replay differs")
	}
	if _, err = s.store.Wallet(readCtx); err != nil {
		t.Fatal("read blocked", err)
	}
	if _, err = s.store.reader.ExecContext(ctx, "UPDATE wallet SET available=0"); err == nil {
		t.Fatal("reader can mutate")
	}
	if s.store.Stats()["reader"].MaxOpenConnections != 4 || s.store.Stats()["writer"].MaxOpenConnections != 1 {
		t.Fatal("pool limits")
	}
	c, cancelWrite := context.WithTimeout(ctx, 20*time.Millisecond)
	defer cancelWrite()
	if _, err = s.Service.Deposit(c, "book", "new", 1); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatal("writer ignored cancellation", err)
	}
}
func TestCancelAndResetRollback(t *testing.T) {
	for _, operation := range []string{"cancel", "reset"} {
		t.Run(operation, func(t *testing.T) {
			s := testStore(t)
			original, err := s.Deposit(ctx, "trip", "keep", 1000)
			if err != nil {
				t.Fatal(err)
			}
			before := balance(t, s)
			trigger := "CREATE TRIGGER fail_delete BEFORE DELETE ON goals BEGIN SELECT RAISE(ABORT,'delete fail'); END"
			mustExec(t, s.db, trigger)
			if operation == "cancel" {
				_, err = s.Cancel(ctx, "trip")
			} else {
				err = s.Reset(ctx)
			}
			if err == nil {
				t.Fatal("expected rollback")
			}
			if balance(t, s) != before {
				t.Fatal("refund/reset partially committed")
			}
			if _, err = s.Goal(ctx, "trip"); err != nil {
				t.Fatal(err)
			}
			replay, err := s.Deposit(ctx, "trip", "keep", 1000)
			if err != nil || !bytes.Equal(replay, original) {
				t.Fatal("rollback lost outcome", err)
			}
		})
	}
}
func TestCanceledAndClosedRepositories(t *testing.T) {
	s := testStore(t)
	c, cancel := context.WithCancel(ctx)
	cancel()
	if err := s.store.WithinWriteTx(c, func(application.Repositories) error { t.Fatal("called canceled tx"); return nil }); !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	err := s.store.WithinWriteTx(ctx, func(r application.Repositories) error {
		if err := r.Goals.SaveGoal(ctx, domain.Goal{ID: "missing"}); err == nil {
			t.Fatal("missing update")
		}
		if err := r.Goals.DeleteGoal(ctx, "missing"); err == nil {
			t.Fatal("missing delete")
		}
		return context.Canceled
	})
	if !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
	mustExec(t, s.db, "INSERT INTO idempotency VALUES('broken','book',1,x'ff')")
	if _, _, err := s.store.Outcome(ctx, "broken"); err == nil {
		t.Fatal("corrupt snapshot accepted")
	}
	s.Close()
	if s.store.Ready(ctx) == nil {
		t.Fatal("closed DB ready")
	}
	if _, err := s.store.Wallet(ctx); err == nil {
		t.Fatal("closed wallet")
	}
	if _, err := s.store.Goal(ctx, "book"); err == nil {
		t.Fatal("closed goal")
	}
	if _, err := s.store.List(ctx, domain.Active); err == nil {
		t.Fatal("closed list")
	}
	if _, _, err := s.store.Outcome(ctx, "broken"); err == nil {
		t.Fatal("closed outcomes")
	}
}
func TestDeterministicOperationModel(t *testing.T) {
	s := testStore(t)
	r := rand.New(rand.NewSource(20261109))
	initial := total(t, s)
	keys := map[string]struct {
		id     string
		amount int64
		raw    []byte
	}{}
	for i := 0; i < 120; i++ {
		ids := []string{"book", "trip", "laptop"}
		id := ids[r.Intn(len(ids))]
		if r.Intn(8) == 0 {
			_, _ = s.Cancel(ctx, id)
		} else {
			key := fmt.Sprint(r.Intn(40))
			amount := int64(r.Intn(300000) + 1)
			if old, ok := keys[key]; ok && r.Intn(2) == 0 {
				id = old.id
				amount = old.amount
			}
			raw, err := s.Deposit(ctx, id, key, amount)
			if err == nil {
				if old, ok := keys[key]; ok && !bytes.Equal(raw, old.raw) {
					t.Fatal("model replay changed")
				}
				keys[key] = struct {
					id     string
					amount int64
					raw    []byte
				}{id, amount, raw}
			}
		}
		if total(t, s) != initial {
			t.Fatalf("money changed at step %d", i)
		}
	}
}
func TestTwoProcessSameKey(t *testing.T) {
	if path := os.Getenv("HADAF_TEST_DB"); path != "" {
		s, err := openTest(path, time.Now)
		if err != nil {
			t.Fatal(err)
		}
		defer s.Close()
		if _, err = s.Deposit(ctx, "book", "two-process", 500000); err != nil {
			t.Fatal(err)
		}
		return
	}
	path := filepath.Join(t.TempDir(), "process.db")
	s, err := openTest(path, time.Now)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	commands := make([]*exec.Cmd, 2)
	outputs := make([]bytes.Buffer, 2)
	for i := range commands {
		commands[i] = exec.Command(os.Args[0], "-test.run=^TestTwoProcessSameKey$")
		commands[i].Env = append(os.Environ(), "HADAF_TEST_DB="+path)
		commands[i].Stdout = &outputs[i]
		commands[i].Stderr = &outputs[i]
		if err := commands[i].Start(); err != nil {
			t.Fatal(err)
		}
	}
	for i, c := range commands {
		if err := c.Wait(); err != nil {
			t.Fatal(err, outputs[i].String())
		}
	}
	if balance(t, s) != 24500000 || total(t, s) != 54500000 {
		t.Fatal("process race double debit")
	}
}
func BenchmarkSQLite(b *testing.B) {
	path := filepath.Join(b.TempDir(), "bench.db")
	s, err := openTest(path, time.Now)
	if err != nil {
		b.Fatal(err)
	}
	defer s.Close()
	if _, err = s.Deposit(ctx, "book", "replay", 1); err != nil {
		b.Fatal(err)
	}
	b.Run("read", func(b *testing.B) {
		for b.Loop() {
			if _, err := s.Wallet(ctx); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("replay", func(b *testing.B) {
		for b.Loop() {
			if _, err := s.Deposit(ctx, "book", "replay", 1); err != nil {
				b.Fatal(err)
			}
		}
	})
	b.Run("deposit", func(b *testing.B) {
		for i := 0; b.Loop(); i++ {
			if _, err := s.Deposit(ctx, "laptop", fmt.Sprint(i), 1); err != nil {
				b.Fatal(err)
			}
		}
	})
}
