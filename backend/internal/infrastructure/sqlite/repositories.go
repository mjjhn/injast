package sqlite

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"injast/hadaf/internal/application"
	"injast/hadaf/internal/domain"
)

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}
type repositories struct {
	q        queryer
	reporter reporter
}
type scanner interface{ Scan(...any) error }

const columns = "id,name,target,saved,deadline,source,status,created_at"

func scanGoal(row scanner) (domain.Goal, error) {
	var goal domain.Goal
	err := row.Scan(&goal.ID, &goal.Name, &goal.TargetAmount, &goal.SavedAmount, &goal.Deadline, &goal.FundingSource, &goal.Status, &goal.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return goal, domain.NotFound()
	}
	return goal, err
}
func (r *repositories) Goal(ctx context.Context, id string) (domain.Goal, error) {
	g, err := scanGoal(r.q.QueryRowContext(ctx, "SELECT "+columns+" FROM goals WHERE id=?", id))
	return g, r.reporter.fail(ctx, "goal_get", "scan", err)
}
func (r *repositories) List(ctx context.Context, status domain.Status) ([]domain.Goal, error) {
	rows, err := r.q.QueryContext(ctx, "SELECT "+columns+" FROM goals WHERE status=? ORDER BY created_at DESC,id ASC", status)
	if err != nil {
		return nil, r.reporter.fail(ctx, "goal_list", "query", err)
	}
	defer rows.Close()
	goals := make([]domain.Goal, 0)
	for rows.Next() {
		g, err := scanGoal(rows)
		if err != nil {
			return nil, r.reporter.fail(ctx, "goal_list", "scan", err)
		}
		goals = append(goals, g)
	}
	return goals, r.reporter.fail(ctx, "goal_list", "rows", rows.Err())
}
func (r *repositories) Wallet(ctx context.Context) (domain.Wallet, error) {
	var w domain.Wallet
	err := r.q.QueryRowContext(ctx, "SELECT available FROM wallet WHERE id=1").Scan(&w.AvailableAmount)
	return w, r.reporter.fail(ctx, "wallet_get", "scan", err)
}
func (r *repositories) SaveWallet(ctx context.Context, w domain.Wallet) error {
	_, err := r.q.ExecContext(ctx, "INSERT INTO wallet(id,available) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET available=excluded.available", w.AvailableAmount)
	return r.reporter.fail(ctx, "wallet_save", "execute", err)
}
func (r *repositories) AddGoal(ctx context.Context, g domain.Goal) error {
	_, err := r.q.ExecContext(ctx, "INSERT INTO goals("+columns+") VALUES(?,?,?,?,?,?,?,?)", g.ID, g.Name, g.TargetAmount, g.SavedAmount, g.Deadline, g.FundingSource, g.Status, g.CreatedAt)
	return r.reporter.fail(ctx, "goal_add", "execute", err)
}
func (r *repositories) SaveGoal(ctx context.Context, g domain.Goal) error {
	result, err := r.q.ExecContext(ctx, "UPDATE goals SET name=?,target=?,saved=?,deadline=?,source=?,status=?,created_at=? WHERE id=?", g.Name, g.TargetAmount, g.SavedAmount, g.Deadline, g.FundingSource, g.Status, g.CreatedAt, g.ID)
	return r.affected(ctx, "goal_save", result, err)
}
func (r *repositories) affected(ctx context.Context, op string, result sql.Result, err error) error {
	if err != nil {
		return r.reporter.fail(ctx, op, "execute", err)
	}
	n, err := result.RowsAffected()
	if err != nil {
		return r.reporter.fail(ctx, op, "rows", err)
	}
	if n != 1 {
		return domain.NotFound()
	}
	return nil
}
func (r *repositories) DeleteGoal(ctx context.Context, id string) error {
	result, err := r.q.ExecContext(ctx, "DELETE FROM goals WHERE id=?", id)
	return r.affected(ctx, "goal_delete", result, err)
}
func (r *repositories) ClearGoals(ctx context.Context) error {
	_, err := r.q.ExecContext(ctx, "DELETE FROM goals")
	return r.reporter.fail(ctx, "goal_clear", "execute", err)
}
func (r *repositories) ClearOutcomes(ctx context.Context) error {
	_, err := r.q.ExecContext(ctx, "DELETE FROM idempotency")
	return r.reporter.fail(ctx, "outcome_clear", "execute", err)
}
func (r *repositories) Outcome(ctx context.Context, key string) (application.Outcome, bool, error) {
	var out application.Outcome
	var raw []byte
	err := r.q.QueryRowContext(ctx, "SELECT goal_id,amount,response FROM idempotency WHERE key=?", key).Scan(&out.GoalID, &out.Amount, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return out, false, nil
	}
	if err != nil {
		return out, false, r.reporter.fail(ctx, "outcome_get", "scan", err)
	}
	var saved snapshot
	if err = json.Unmarshal(raw, &saved); err != nil {
		return out, false, r.reporter.fail(ctx, "outcome_get", "decode", err)
	}
	out.Result = saved.domain()
	return out, true, nil
}
func (r *repositories) SaveOutcome(ctx context.Context, key string, out application.Outcome) error {
	raw, err := encodeSnapshot(out.Result)
	if err != nil {
		return r.reporter.fail(ctx, "outcome_save", "encode", err)
	}
	_, err = r.q.ExecContext(ctx, "INSERT INTO idempotency(key,goal_id,amount,response) VALUES(?,?,?,?)", key, out.GoalID, out.Amount, raw)
	return r.reporter.fail(ctx, "outcome_save", "execute", err)
}
