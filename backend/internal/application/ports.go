// Package application owns use cases and the ports required to run them.
package application

import (
	"context"
	"errors"
	"injast/hadaf/internal/domain"
	"time"
)

type GoalReader interface {
	Goal(context.Context, string) (domain.Goal, error)
	List(context.Context, domain.Status) ([]domain.Goal, error)
}
type WalletReader interface {
	Wallet(context.Context) (domain.Wallet, error)
}
type Outcome struct {
	GoalID string
	Amount domain.Money
	Result domain.DepositResult
}
type OutcomeReader interface {
	Outcome(context.Context, string) (Outcome, bool, error)
}
type Reader interface {
	GoalReader
	WalletReader
	OutcomeReader
}
type GoalRepository interface {
	GoalReader
	AddGoal(context.Context, domain.Goal) error
	SaveGoal(context.Context, domain.Goal) error
	DeleteGoal(context.Context, string) error
	ClearGoals(context.Context) error
}
type WalletRepository interface {
	WalletReader
	SaveWallet(context.Context, domain.Wallet) error
}
type OutcomeRepository interface {
	OutcomeReader
	SaveOutcome(context.Context, string, Outcome) error
	ClearOutcomes(context.Context) error
}
type Repositories struct {
	Goals    GoalRepository
	Wallets  WalletRepository
	Outcomes OutcomeRepository
}
type UnitOfWork interface {
	WithinWriteTx(context.Context, func(Repositories) error) error
}
type Observer interface{ Operation(context.Context, Event) }
type Event struct {
	Name     string
	Outcome  string
	Reason   string
	KeyHash  string
	Duration time.Duration
}
type Receipt struct {
	Result   domain.DepositResult
	Replayed bool
}
type InitialState struct {
	Wallet domain.Wallet
	Goals  []domain.Goal
}

func SeedState(now time.Time) InitialState {
	date := domain.Today(now).AddDate(0, 0, 90).Format("2006-01-02")
	created := now.UTC().Format(time.RFC3339)
	return InitialState{Wallet: domain.Wallet{AvailableAmount: 25000000}, Goals: []domain.Goal{
		{ID: "book", Name: "کتاب", TargetAmount: 2000000, SavedAmount: 1500000, Deadline: date, FundingSource: domain.WalletSource, Status: domain.Active, CreatedAt: created},
		{ID: "trip", Name: "سفر شمال", TargetAmount: 45000000, SavedAmount: 8000000, Deadline: date, FundingSource: domain.MonthlySource, Status: domain.Active, CreatedAt: created},
		{ID: "laptop", Name: "لپ‌تاپ", TargetAmount: 80000000, SavedAmount: 20000000, Deadline: date, FundingSource: domain.MonthlySource, Status: domain.Active, CreatedAt: created},
	}}
}

var ErrCommitUncertain = errors.New("transaction commit outcome uncertain")

type StorageError struct {
	Kind       string
	Operation  string
	Stage      string
	DriverCode int
	Err        error
}

func (e *StorageError) Error() string { return e.Kind + ": " + e.Err.Error() }
func (e *StorageError) Unwrap() error { return e.Err }
