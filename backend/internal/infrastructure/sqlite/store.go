// Package sqlite implements application repository ports and a shared Unit of Work.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	_ "modernc.org/sqlite"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

type Store struct {
	writer, reader *sql.DB
	FromVersion    int
	reporter       reporter
}

func dsn(path string, readOnly bool) string {
	uri := url.URL{Scheme: "file", Path: path}
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(1000)")
	if readOnly {
		q.Set("mode", "ro")
		q.Add("_pragma", "query_only(1)")
	} else {
		q.Add("_pragma", "journal_mode(WAL)")
		q.Add("_pragma", "synchronous(FULL)")
		q.Add("_pragma", "foreign_keys(1)")
		q.Set("_txlock", "immediate")
	}
	uri.RawQuery = q.Encode()
	return uri.String()
}
func Open(path string, now func() time.Time, observers ...application.StorageObserver) (*Store, error) {
	var report reporter
	if len(observers) > 0 {
		report.observer = observers[0]
	}
	openFailure := func(err error) (*Store, error) { return nil, report.fail(context.Background(), "open", "open", err) }
	if now == nil {
		now = time.Now
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return openFailure(err)
	}
	if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return openFailure(err)
	}
	// Check an existing file before writer connection pragmas can change its
	// journal header. Unsupported future schema must fail without touching bytes.
	if info, statErr := os.Stat(path); statErr == nil && info.Mode().IsRegular() && info.Size() > 0 {
		preflight, openErr := sql.Open("sqlite", dsn(path, true))
		if openErr != nil {
			return openFailure(openErr)
		}
		checkCtx, cancelCheck := context.WithTimeout(context.Background(), 5*time.Second)
		var version int
		checkErr := preflight.QueryRowContext(checkCtx, "PRAGMA user_version").Scan(&version)
		preflight.Close()
		cancelCheck()
		if checkErr != nil {
			return nil, report.fail(context.Background(), "migration", "query", checkErr)
		}
		if version > 2 {
			return nil, report.fail(context.Background(), "migration", "query", fmt.Errorf("unsupported database schema version %d", version))
		}
	}
	writer, err := sql.Open("sqlite", dsn(path, false))
	if err != nil {
		return openFailure(err)
	}
	writer.SetMaxOpenConns(1)
	writer.SetMaxIdleConns(1)
	s := &Store{writer: writer, reporter: report}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err = s.initialize(ctx, application.SeedState(now())); err != nil {
		writer.Close()
		return openFailure(err)
	}
	reader, err := sql.Open("sqlite", dsn(path, true))
	if err != nil {
		writer.Close()
		return openFailure(err)
	}
	reader.SetMaxOpenConns(4)
	reader.SetMaxIdleConns(4)
	s.reader = reader
	if err = s.Ready(ctx); err != nil {
		s.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) initialize(ctx context.Context, seed application.InitialState) (err error) {
	stage := "begin"
	defer func() { err = s.reporter.fail(ctx, "migration", stage, err) }()
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer s.reporter.rollback(ctx, tx)
	stage = "query"
	var version int
	if err = tx.QueryRowContext(ctx, "PRAGMA user_version").Scan(&version); err != nil {
		return err
	}
	s.FromVersion = version
	if version > 2 {
		return fmt.Errorf("unsupported database schema version %d", version)
	}
	stage = "execute"
	if _, err = tx.ExecContext(ctx, schema); err != nil {
		return err
	}
	if version == 0 {
		repo := repositories{q: tx, reporter: s.reporter}
		if err = repo.SaveWallet(ctx, seed.Wallet); err != nil {
			return err
		}
		for _, goal := range seed.Goals {
			if err = repo.AddGoal(ctx, goal); err != nil {
				return err
			}
		}
	}
	if version < 2 {
		if _, err = tx.ExecContext(ctx, "CREATE INDEX IF NOT EXISTS goals_status_created_id ON goals(status,created_at DESC,id ASC); PRAGMA user_version=2;"); err != nil {
			return err
		}
	}
	stage = "commit"
	return tx.Commit()
}
func (s *Store) WithinWriteTx(ctx context.Context, fn func(application.Repositories) error) error {
	tx, err := s.writer.BeginTx(ctx, nil)
	if err != nil {
		return s.reporter.fail(ctx, "transaction", "begin", err)
	}
	defer s.reporter.rollback(ctx, tx)
	repo := &repositories{q: tx, reporter: s.reporter}
	if err = fn(application.Repositories{Goals: repo, Wallets: repo, Outcomes: repo}); err != nil {
		return err
	}
	if err = ctx.Err(); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return s.reporter.commitFailure(ctx, err)
	}
	return nil
}
func (s *Store) Goal(ctx context.Context, id string) (domain.Goal, error) {
	return (&repositories{q: s.reader, reporter: s.reporter}).Goal(ctx, id)
}
func (s *Store) List(ctx context.Context, status domain.Status) ([]domain.Goal, error) {
	return (&repositories{q: s.reader, reporter: s.reporter}).List(ctx, status)
}
func (s *Store) Wallet(ctx context.Context) (domain.Wallet, error) {
	return (&repositories{q: s.reader, reporter: s.reporter}).Wallet(ctx)
}
func (s *Store) Outcome(ctx context.Context, key string) (application.Outcome, bool, error) {
	return (&repositories{q: s.reader, reporter: s.reporter}).Outcome(ctx, key)
}
func (s *Store) Ready(ctx context.Context) error {
	return s.reporter.fail(ctx, "readiness", "ping", s.reader.PingContext(ctx))
}
func (s *Store) Stats() map[string]sql.DBStats {
	return map[string]sql.DBStats{"writer": s.writer.Stats(), "reader": s.reader.Stats()}
}
func (s *Store) Close() error {
	var readError error
	if s.reader != nil {
		readError = s.reader.Close()
	}
	return errors.Join(readError, s.writer.Close())
}

var _ application.Reader = (*Store)(nil)
var _ application.UnitOfWork = (*Store)(nil)
