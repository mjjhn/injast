package bootstrap

import (
	"context"
	"errors"
	"injast/hadaf/internal/application"
	"io"
	"log/slog"
	"syscall"
	"time"
)

// Failure preserves the cause for internal inspection; logging uses only bounded
// metadata, never Error() strings containing paths or configuration values.
type Failure struct {
	Stage, Kind string
	Err         error
}

func (e *Failure) Error() string { return e.Stage + ": " + e.Err.Error() }
func (e *Failure) Unwrap() error { return e.Err }
func failed(stage string, err error) error {
	if err == nil {
		return nil
	}
	kind := "unknown"
	switch {
	case errors.Is(err, syscall.EADDRINUSE):
		kind = "address_in_use"
	case errors.Is(err, syscall.EACCES), errors.Is(err, syscall.EPERM):
		kind = "permission"
	case errors.Is(err, context.DeadlineExceeded):
		kind = "deadline"
	}
	var storage *application.StorageError
	if errors.As(err, &storage) {
		kind = storage.Kind
	}
	return &Failure{Stage: stage, Kind: kind, Err: err}
}
func NewLogger(w io.Writer, level slog.Leveler) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level, ReplaceAttr: func(_ []string, a slog.Attr) slog.Attr {
		if a.Key == slog.TimeKey {
			a.Value = slog.TimeValue(a.Value.Time().In(time.UTC))
		}
		return a
	}}))
}
func LogFailure(logger *slog.Logger, err error) {
	stage, kind := "runtime", "unknown"
	var failure *Failure
	if errors.As(err, &failure) {
		stage, kind = failure.Stage, failure.Kind
	}
	attrs := []slog.Attr{slog.String("stage", stage), slog.String("reason", kind)}
	var storage *application.StorageError
	if errors.As(err, &storage) {
		d := storage.Diagnostic()
		attrs = append(attrs, slog.String("storage_operation", d.Operation), slog.String("storage_stage", d.Stage))
		if d.DriverCode != 0 {
			attrs = append(attrs, slog.Int("sqlite_code", d.DriverCode))
		}
	}
	logger.LogAttrs(context.Background(), slog.LevelError, "startup_or_runtime_failed", attrs...)
}
