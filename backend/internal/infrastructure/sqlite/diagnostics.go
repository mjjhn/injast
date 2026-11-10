package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
	"io/fs"
	sqlitedriver "modernc.org/sqlite"
	"strings"
)

type reporter struct{ observer application.StorageObserver }

func classify(err error) (string, int) {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline", 0
	case errors.Is(err, context.Canceled):
		return "canceled", 0
	}
	var syntax *json.SyntaxError
	var typed *json.UnmarshalTypeError
	if errors.As(err, &syntax) || errors.As(err, &typed) {
		return "corrupt", 0
	}
	var driver *sqlitedriver.Error
	if errors.As(err, &driver) {
		code := driver.Code()
		switch code & 255 {
		case 5, 6:
			return "busy", code
		case 19:
			return "constraint", code
		case 10, 13, 14, 3, 8:
			return "io", code
		case 11, 26:
			return "corrupt", code
		}
		return "unknown", code
	}
	if errors.Is(err, sql.ErrConnDone) || strings.Contains(err.Error(), "sql: database is closed") {
		return "closed", 0
	}
	if errors.Is(err, fs.ErrPermission) || errors.Is(err, fs.ErrNotExist) || errors.Is(err, fs.ErrExist) {
		return "io", 0
	}
	return "unknown", 0
}

func (r reporter) fail(ctx context.Context, operation, stage string, err error) error {
	if err == nil {
		return nil
	}
	var business *domain.Error
	var previous *application.StorageError
	if errors.As(err, &business) || errors.As(err, &previous) {
		return err
	}
	kind, code := classify(err)
	wrapped := &application.StorageError{Operation: operation, Stage: stage, Kind: kind, DriverCode: code, Err: err}
	if r.observer != nil {
		r.observer.StorageFailure(ctx, wrapped.Diagnostic())
	}
	return wrapped
}
func (r reporter) rollback(ctx context.Context, tx *sql.Tx) {
	if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
		r.fail(ctx, "transaction", "rollback", err)
	}
}

// Both identities must survive: callers reconcile an uncertain commit, while
// diagnostics retain the underlying driver/context error without stringifying it.
func (r reporter) commitFailure(ctx context.Context, err error) error {
	return r.fail(ctx, "transaction", "commit", errors.Join(application.ErrCommitUncertain, err))
}
