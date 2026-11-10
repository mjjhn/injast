package main

import (
	"context"
	"injast/hadaf/internal/bootstrap"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
)

func run(logger *slog.Logger, level *slog.LevelVar) error {
	cfg, err := bootstrap.Load(os.Getenv)
	if err != nil {
		return &bootstrap.Failure{Stage: "configuration", Kind: "invalid", Err: err}
	}
	level.Set(cfg.LogLevel)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	return bootstrap.Run(ctx, cfg, logger)
}
func main() {
	var level slog.LevelVar
	logger := bootstrap.NewLogger(os.Stdout, &level)
	if err := run(logger, &level); err != nil {
		bootstrap.LogFailure(logger, err)
		os.Exit(1)
	}
}
