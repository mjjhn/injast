package application

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"injast/hadaf/internal/domain"
	"time"
)

type Service struct {
	read     Reader
	uow      UnitOfWork
	now      func() time.Time
	newID    func() (string, error)
	observer Observer
}

func New(read Reader, uow UnitOfWork, now func() time.Time, newID func() (string, error), observer Observer) *Service {
	if now == nil {
		now = time.Now
	}
	if newID == nil {
		newID = func() (string, error) { return "", fmt.Errorf("ID generator not configured") }
	}
	return &Service{read: read, uow: uow, now: now, newID: newID, observer: observer}
}
func (s *Service) observed(ctx context.Context, name, key string, start time.Time, err error, replayed bool) {
	if s.observer == nil {
		return
	}
	event := Event{Name: name, Outcome: "committed", Duration: time.Since(start)}
	if replayed {
		event.Outcome = "replayed"
	}
	if key != "" {
		hash := sha256.Sum256([]byte(key))
		event.KeyHash = hex.EncodeToString(hash[:8])
	}
	if err != nil {
		event.Outcome = "rejected"
		event.Reason = "storage"
		var business *domain.Error
		var storage *StorageError
		switch {
		case errors.As(err, &business):
			event.Reason = business.Code
		case errors.Is(err, ErrCommitUncertain):
			event.Outcome = "uncertain"
			event.Reason = "commit_unknown"
		case errors.Is(err, context.DeadlineExceeded):
			event.Reason = "deadline"
		case errors.Is(err, context.Canceled):
			event.Reason = "canceled"
		case errors.As(err, &storage):
			event.Reason = storage.Kind
		}
	}
	s.observer.Operation(ctx, event)
}
func (s *Service) Goal(ctx context.Context, id string) (domain.Goal, error) {
	return s.read.Goal(ctx, id)
}
func (s *Service) Wallet(ctx context.Context) (domain.Wallet, error) { return s.read.Wallet(ctx) }
func (s *Service) List(ctx context.Context, status domain.Status) ([]domain.Goal, error) {
	if status != domain.Active && status != domain.Completed {
		return nil, domain.Validation("status", "وضعیت باید active یا completed باشد.")
	}
	return s.read.List(ctx, status)
}
func (s *Service) Create(ctx context.Context, in domain.CreateInput) (goal domain.Goal, err error) {
	start := time.Now()
	defer func() { s.finish(ctx, "create", "", start, err, false, recover()) }()
	now := s.now()
	if err = domain.ValidateCreate(&in, now); err != nil {
		return
	}
	id, e := s.newID()
	if e != nil {
		err = e
		return
	}
	goal = domain.Goal{ID: id, Name: in.Name, TargetAmount: in.TargetAmount, Deadline: in.Deadline, FundingSource: in.FundingSource, Status: domain.Active, CreatedAt: now.UTC().Format(time.RFC3339)}
	err = s.uow.WithinWriteTx(ctx, func(r Repositories) error { return r.Goals.AddGoal(ctx, goal) })
	if err != nil {
		goal = domain.Goal{}
	}
	return
}
func match(outcome Outcome, id string, amount domain.Money) (Receipt, error) {
	if outcome.GoalID != id || outcome.Amount != amount {
		return Receipt{}, domain.Conflict()
	}
	return Receipt{Result: outcome.Result, Replayed: true}, nil
}
func (s *Service) Deposit(ctx context.Context, id, key string, amount domain.Money) (receipt Receipt, err error) {
	start := time.Now()
	defer func() { s.finish(ctx, "deposit", key, start, err, receipt.Replayed, recover()) }()
	if key == "" {
		return receipt, &domain.Error{Code: "MISSING_IDEMPOTENCY_KEY", Message: "کلید یکتای واریز الزامی است."}
	}
	previous, found, e := s.read.Outcome(ctx, key)
	if e != nil {
		return receipt, e
	}
	if found {
		return match(previous, id, amount)
	}
	err = s.uow.WithinWriteTx(ctx, func(r Repositories) error {
		previous, found, e := r.Outcomes.Outcome(ctx, key)
		if e != nil {
			return e
		}
		if found {
			receipt, e = match(previous, id, amount)
			return e
		}
		goal, e := r.Goals.Goal(ctx, id)
		if e != nil {
			return e
		}
		wallet, e := r.Wallets.Wallet(ctx)
		if e != nil {
			return e
		}
		result, e := domain.Deposit(goal, wallet, amount)
		if e != nil {
			return e
		}
		if e = r.Wallets.SaveWallet(ctx, result.Wallet); e != nil {
			return e
		}
		if e = r.Goals.SaveGoal(ctx, result.Goal); e != nil {
			return e
		}
		if e = r.Outcomes.SaveOutcome(ctx, key, Outcome{GoalID: id, Amount: amount, Result: result}); e != nil {
			return e
		}
		receipt = Receipt{Result: result}
		return nil
	})
	if err != nil {
		receipt = Receipt{}
	}
	return
}
func (s *Service) Cancel(ctx context.Context, id string) (wallet domain.Wallet, err error) {
	start := time.Now()
	defer func() { s.finish(ctx, "cancel", "", start, err, false, recover()) }()
	err = s.uow.WithinWriteTx(ctx, func(r Repositories) error {
		goal, e := r.Goals.Goal(ctx, id)
		if e != nil {
			return e
		}
		before, e := r.Wallets.Wallet(ctx)
		if e != nil {
			return e
		}
		wallet, e = domain.Refund(goal, before)
		if e != nil {
			return e
		}
		if e = r.Wallets.SaveWallet(ctx, wallet); e != nil {
			return e
		}
		return r.Goals.DeleteGoal(ctx, id)
	})
	if err != nil {
		wallet = domain.Wallet{}
	}
	return
}
func (s *Service) Reset(ctx context.Context) (err error) {
	start := time.Now()
	defer func() { s.finish(ctx, "reset", "", start, err, false, recover()) }()
	state := SeedState(s.now())
	return s.uow.WithinWriteTx(ctx, func(r Repositories) error {
		if e := r.Outcomes.ClearOutcomes(ctx); e != nil {
			return e
		}
		if e := r.Goals.ClearGoals(ctx); e != nil {
			return e
		}
		if e := r.Wallets.SaveWallet(ctx, state.Wallet); e != nil {
			return e
		}
		for _, goal := range state.Goals {
			if e := r.Goals.AddGoal(ctx, goal); e != nil {
				return e
			}
		}
		return nil
	})
}

func (s *Service) finish(ctx context.Context, name, key string, start time.Time, err error, replayed bool, recovered any) {
	if recovered != nil {
		s.observed(ctx, name, key, start, fmt.Errorf("operation panic"), false)
		panic(recovered)
	}
	s.observed(ctx, name, key, start, err, replayed)
}
