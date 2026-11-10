package domain

import (
	"math"
	"testing"
)

func TestTransitionsAndCorruptState(t *testing.T) {
	g := Goal{TargetAmount: 100, SavedAmount: 40, Status: Active}
	w := Wallet{AvailableAmount: 60}
	r, err := Deposit(g, w, 60)
	if err != nil || r.Goal.Status != Completed || r.Wallet.AvailableAmount != 0 || g.SavedAmount != 40 {
		t.Fatal(r, err)
	}
	refunded, err := Refund(g, w)
	if err != nil || refunded.AvailableAmount != 100 {
		t.Fatal(refunded, err)
	}
	for _, tc := range []struct {
		g Goal
		w Wallet
	}{
		{Goal{Status: Completed}, w}, {Goal{Status: Active, SavedAmount: -1}, w},
		{Goal{Status: Active, SavedAmount: 1}, Wallet{AvailableAmount: Money(math.MaxInt64)}},
		{g, Wallet{AvailableAmount: -1}},
	} {
		if _, err := Refund(tc.g, tc.w); err == nil {
			t.Fatal("invalid refund allowed")
		}
	}
	for _, tc := range []struct {
		g Goal
		w Wallet
	}{
		{Goal{Status: Active, SavedAmount: -1, TargetAmount: 100}, w},
		{Goal{Status: Active, SavedAmount: 101, TargetAmount: 100}, w},
		{g, Wallet{AvailableAmount: -1}},
	} {
		if _, err := Deposit(tc.g, tc.w, 1); err == nil {
			t.Fatal("invalid state allowed")
		}
	}
}

func FuzzDepositConservesMoney(f *testing.F) {
	f.Add(int64(100), int64(30), int64(1000), int64(20))
	f.Add(int64(100), int64(100), int64(0), int64(1))
	f.Fuzz(func(t *testing.T, target, saved, balance, amount int64) {
		target = int64(uint64(target) % 200000001)
		saved = int64(uint64(saved) % 200000001)
		balance = int64(uint64(balance) % 1000000000)
		g := Goal{TargetAmount: Money(target), SavedAmount: Money(saved), Status: Active}
		w := Wallet{AvailableAmount: Money(balance)}
		r, err := Deposit(g, w, Money(amount))
		if err != nil {
			return
		}
		if r.Goal.SavedAmount+r.Wallet.AvailableAmount != g.SavedAmount+w.AvailableAmount || r.Wallet.AvailableAmount < 0 || r.Goal.SavedAmount > r.Goal.TargetAmount {
			t.Fatal("money invariant")
		}
		if (r.Goal.Status == Completed) != (r.Goal.SavedAmount == r.Goal.TargetAmount) {
			t.Fatal("completion invariant")
		}
	})
}
