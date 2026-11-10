package application

import (
	"context"
	"errors"
	"fmt"
	"injast/hadaf/internal/domain"
	"reflect"
	"testing"
	"time"
)

var testNow = time.Date(2026, 11, 9, 12, 0, 0, 0, domain.Tehran)
var testContext = context.Background()
var injected = errors.New("injected repository failure")

type memory struct {
	goals      map[string]domain.Goal
	wallet     domain.Wallet
	outcomes   map[string]Outcome
	fail       string
	inside     bool
	panicWrite bool
	commits    int
}

func newMemory() *memory {
	seed := SeedState(testNow)
	m := &memory{goals: map[string]domain.Goal{}, wallet: seed.Wallet, outcomes: map[string]Outcome{}}
	for _, g := range seed.Goals {
		m.goals[g.ID] = g
	}
	return m
}
func (m *memory) fault(point string) error {
	if m.fail == point || (m.inside && m.fail == "tx_"+point) {
		return injected
	}
	return nil
}
func (m *memory) Goal(_ context.Context, id string) (domain.Goal, error) {
	if err := m.fault("goal"); err != nil {
		return domain.Goal{}, err
	}
	g, ok := m.goals[id]
	if !ok {
		return g, domain.NotFound()
	}
	return g, nil
}
func (m *memory) List(_ context.Context, status domain.Status) ([]domain.Goal, error) {
	if err := m.fault("list"); err != nil {
		return nil, err
	}
	out := []domain.Goal{}
	for _, g := range m.goals {
		if g.Status == status {
			out = append(out, g)
		}
	}
	return out, nil
}
func (m *memory) Wallet(context.Context) (domain.Wallet, error) { return m.wallet, m.fault("wallet") }
func (m *memory) Outcome(_ context.Context, key string) (Outcome, bool, error) {
	o, ok := m.outcomes[key]
	return o, ok, m.fault("outcome")
}
func (m *memory) SaveWallet(_ context.Context, w domain.Wallet) error {
	if e := m.fault("save_wallet"); e != nil {
		return e
	}
	m.wallet = w
	return nil
}
func (m *memory) AddGoal(_ context.Context, g domain.Goal) error {
	if e := m.fault("add"); e != nil {
		return e
	}
	if _, ok := m.goals[g.ID]; ok {
		return injected
	}
	m.goals[g.ID] = g
	return nil
}
func (m *memory) SaveGoal(_ context.Context, g domain.Goal) error {
	if e := m.fault("save_goal"); e != nil {
		return e
	}
	m.goals[g.ID] = g
	return nil
}
func (m *memory) DeleteGoal(_ context.Context, id string) error {
	if e := m.fault("delete"); e != nil {
		return e
	}
	delete(m.goals, id)
	return nil
}
func (m *memory) ClearGoals(context.Context) error {
	if e := m.fault("clear_goals"); e != nil {
		return e
	}
	m.goals = map[string]domain.Goal{}
	return nil
}
func (m *memory) SaveOutcome(_ context.Context, key string, out Outcome) error {
	if e := m.fault("save_outcome"); e != nil {
		return e
	}
	m.outcomes[key] = out
	return nil
}
func (m *memory) ClearOutcomes(context.Context) error {
	if e := m.fault("clear_outcomes"); e != nil {
		return e
	}
	m.outcomes = map[string]Outcome{}
	return nil
}
func (m *memory) WithinWriteTx(ctx context.Context, fn func(Repositories) error) error {
	if m.panicWrite {
		panic("private panic payload")
	}
	if err := m.fault("begin"); err != nil {
		return err
	}
	copy := *m
	copy.inside = true
	copy.goals = map[string]domain.Goal{}
	copy.outcomes = map[string]Outcome{}
	for k, v := range m.goals {
		copy.goals[k] = v
	}
	for k, v := range m.outcomes {
		copy.outcomes[k] = v
	}
	if err := fn(Repositories{Goals: &copy, Wallets: &copy, Outcomes: &copy}); err != nil {
		return err
	}
	if m.fail == "commit" {
		return ErrCommitUncertain
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	m.goals = copy.goals
	m.wallet = copy.wallet
	m.outcomes = copy.outcomes
	m.commits++
	return nil
}

type events struct{ values []Event }

func (e *events) Operation(_ context.Context, event Event) { e.values = append(e.values, event) }
func service(m *memory, observer Observer) *Service {
	return New(m, m, func() time.Time { return testNow }, func() (string, error) { return "new-goal", nil }, observer)
}
func code(t *testing.T, err error, want string) {
	t.Helper()
	var e *domain.Error
	if !errors.As(err, &e) || e.Code != want {
		t.Fatalf("want %s got %v", want, err)
	}
}
func TestUseCasesAndReplay(t *testing.T) {
	m := newMemory()
	log := &events{}
	s := service(m, log)
	if _, err := s.Create(testContext, domain.CreateInput{Name: "x"}); err == nil {
		t.Fatal("invalid create")
	}
	goal, err := s.Create(testContext, domain.CreateInput{Name: "  دوچرخه  ", TargetAmount: 500000, Deadline: "2027-02-01", FundingSource: domain.WalletSource, AcceptedTerms: true})
	if err != nil || goal.Name != "دوچرخه" {
		t.Fatal(goal, err)
	}
	if _, err = s.Goal(testContext, goal.ID); err != nil {
		t.Fatal(err)
	}
	if _, err = s.List(testContext, domain.Active); err != nil {
		t.Fatal(err)
	}
	if _, err = s.List(testContext, "bad"); err == nil {
		t.Fatal("bad status")
	}
	if _, err = s.Wallet(testContext); err != nil {
		t.Fatal(err)
	}
	first, err := s.Deposit(testContext, "book", "private-key", 500000)
	if err != nil || first.Result.Goal.Status != domain.Completed || first.Replayed {
		t.Fatal(first, err)
	}
	commits := m.commits
	replay, err := s.Deposit(testContext, "book", "private-key", 500000)
	if err != nil || !replay.Replayed || !reflect.DeepEqual(first.Result, replay.Result) || m.commits != commits {
		t.Fatal("not a read-only replay", err)
	}
	_, err = s.Deposit(testContext, "trip", "private-key", 500000)
	code(t, err, "IDEMPOTENCY_CONFLICT")
	_, err = s.Deposit(testContext, "book", "", 500000)
	code(t, err, "MISSING_IDEMPOTENCY_KEY")
	_, err = s.Cancel(testContext, "book")
	code(t, err, "NOT_ALLOWED")
	if _, err = s.Deposit(testContext, "trip", "deleted", 1000); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Cancel(testContext, "trip"); err != nil {
		t.Fatal(err)
	}
	if _, err = s.Deposit(testContext, "trip", "deleted", 1000); err != nil {
		t.Fatal(err)
	}
	if err = s.Reset(testContext); err != nil {
		t.Fatal(err)
	}
	if m.wallet.AvailableAmount != 25000000 || len(m.outcomes) != 0 || len(m.goals) != 3 {
		t.Fatal("reset incomplete")
	}
	for _, event := range log.values {
		if event.KeyHash == "private-key" {
			t.Fatal("raw key exposed")
		}
	}
}
func TestFailurePathsNeverReportCommit(t *testing.T) {
	tests := []struct {
		name   string
		run    func(*Service) error
		points []string
	}{
		{"deposit", func(s *Service) error { _, e := s.Deposit(testContext, "book", "key", 1000); return e }, []string{"outcome", "begin", "tx_outcome", "goal", "wallet", "save_wallet", "save_goal", "save_outcome", "commit"}},
		{"cancel", func(s *Service) error { _, e := s.Cancel(testContext, "trip"); return e }, []string{"begin", "goal", "wallet", "save_wallet", "delete", "commit"}},
		{"reset", func(s *Service) error { return s.Reset(testContext) }, []string{"begin", "clear_outcomes", "clear_goals", "save_wallet", "add", "commit"}},
		{"create", func(s *Service) error {
			_, e := s.Create(testContext, domain.CreateInput{Name: "تست", TargetAmount: 500000, Deadline: "2027-02-01", FundingSource: domain.WalletSource, AcceptedTerms: true})
			return e
		}, []string{"begin", "add", "commit"}},
	}
	for _, tc := range tests {
		for _, point := range tc.points {
			t.Run(tc.name+"/"+point, func(t *testing.T) {
				m := newMemory()
				before := m.wallet
				m.fail = point
				log := &events{}
				err := tc.run(service(m, log))
				if err == nil || m.wallet != before {
					t.Fatal("failure committed", err)
				}
				if len(log.values) != 1 || log.values[0].Outcome == "committed" {
					t.Fatal(log.values)
				}
			})
		}
	}
}
func TestLookupRaceRechecksInsideTransaction(t *testing.T) {
	m := newMemory()
	s := service(m, nil)
	existing := Outcome{GoalID: "book", Amount: 1000, Result: domain.DepositResult{Goal: m.goals["book"], Wallet: m.wallet}}
	reader := &missOnce{memory: m, existing: existing}
	s.read = reader
	result, err := s.Deposit(testContext, "book", "race", 1000)
	if err != nil || !result.Replayed || m.wallet.AvailableAmount != 25000000 {
		t.Fatal(result, err)
	}
	m.outcomes["race"] = Outcome{GoalID: "trip", Amount: 1000}
	reader.done = false
	_, err = s.Deposit(testContext, "book", "race", 1000)
	code(t, err, "IDEMPOTENCY_CONFLICT")
}

type missOnce struct {
	*memory
	existing Outcome
	done     bool
}

func (r *missOnce) Outcome(ctx context.Context, key string) (Outcome, bool, error) {
	if !r.done {
		r.done = true
		if _, ok := r.outcomes[key]; !ok {
			r.outcomes[key] = r.existing
		}
		return Outcome{}, false, nil
	}
	return r.memory.Outcome(ctx, key)
}
func TestIDFailureAndObserverReasons(t *testing.T) {
	m := newMemory()
	s := New(m, m, nil, func() (string, error) { return "", injected }, nil)
	_, err := s.Create(testContext, domain.CreateInput{Name: "تست", TargetAmount: 500000, Deadline: domain.Today(time.Now()).AddDate(0, 0, 40).Format("2006-01-02"), FundingSource: domain.WalletSource, AcceptedTerms: true})
	if err == nil {
		t.Fatal("missing generator error")
	}
	log := &events{}
	s = service(m, log)
	for _, err := range []error{context.DeadlineExceeded, context.Canceled, &StorageError{Kind: "busy", Err: injected}, fmt.Errorf("%w: error", ErrCommitUncertain)} {
		s.observed(testContext, "deposit", "key", time.Now(), err, false)
	}
	if log.values[0].Reason != "deadline" || log.values[1].Reason != "canceled" || log.values[2].Reason != "busy" || log.values[3].Outcome != "uncertain" {
		t.Fatal(log.values)
	}
	if (&StorageError{Kind: "busy", Err: injected}).Error() == "" || !errors.Is(&StorageError{Err: injected}, injected) {
		t.Fatal("error chain")
	}
}
func TestPanicIsNotLoggedAsCommit(t *testing.T) {
	m := newMemory()
	m.panicWrite = true
	log := &events{}
	defer func() {
		if recover() == nil {
			t.Fatal("missing panic")
		}
		if len(log.values) != 1 || log.values[0].Outcome == "committed" {
			t.Fatal(log.values)
		}
	}()
	_, _ = service(m, log).Cancel(testContext, "trip")
}
