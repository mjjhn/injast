package domain

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCreateValidation(t *testing.T) {
	now := time.Date(2024, 2, 29, 12, 0, 0, 0, Tehran)
	valid := CreateInput{Name: "  دوچرخه  ", TargetAmount: 500000, Deadline: "2024-03-30", FundingSource: "wallet", AcceptedTerms: true}
	cases := []struct {
		name   string
		change func(*CreateInput)
		field  string
	}{
		{"minimums and trim", func(v *CreateInput) {}, ""},
		{"upper inclusive", func(v *CreateInput) {
			v.Name = strings.Repeat("ا", 32)
			v.TargetAmount = 200000000
			v.Deadline = "2026-02-28"
		}, ""},
		{"short unicode", func(v *CreateInput) { v.Name = "اب" }, "name"},
		{"long unicode", func(v *CreateInput) { v.Name = strings.Repeat("ا", 33) }, "name"},
		{"target below", func(v *CreateInput) { v.TargetAmount = 499999 }, "targetAmount"},
		{"target above", func(v *CreateInput) { v.TargetAmount = 200000001 }, "targetAmount"},
		{"date below", func(v *CreateInput) { v.Deadline = "2024-03-29" }, "deadline"},
		{"date above", func(v *CreateInput) { v.Deadline = "2026-03-01" }, "deadline"},
		{"impossible date", func(v *CreateInput) { v.Deadline = "2024-06-31" }, "deadline"},
		{"format", func(v *CreateInput) { v.Deadline = "2024-3-30" }, "deadline"},
		{"source", func(v *CreateInput) { v.FundingSource = "other" }, "fundingSource"},
		{"terms", func(v *CreateInput) { v.AcceptedTerms = false }, "acceptedTerms"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			v := valid
			tc.change(&v)
			err := ValidateCreate(&v, now)
			if tc.field == "" {
				if err != nil {
					t.Fatal(err)
				}
				if v.Name != strings.TrimSpace(v.Name) {
					t.Fatal("not trimmed")
				}
				return
			}
			var e *Error
			if !errors.As(err, &e) || e.Field != tc.field {
				t.Fatalf("want field %s, got %v", tc.field, err)
			}
		})
	}
}
func TestServerDateUsesTehran(t *testing.T) {
	now := time.Date(2026, 11, 9, 21, 0, 0, 0, time.UTC)
	if Today(now).Format("2006-01-02") != "2026-11-10" {
		t.Fatal("server date must use Tehran")
	}
}
func TestDepositValidation(t *testing.T) {
	goal := Goal{Status: "active", TargetAmount: 2000000, SavedAmount: 1500000}
	for _, tc := range []struct {
		name            string
		g               Goal
		balance, amount int64
		code            string
	}{
		{"positive", goal, 25000000, 500000, ""}, {"zero", goal, 25000000, 0, "VALIDATION"}, {"negative", goal, 25000000, -1, "VALIDATION"},
		{"over target first", goal, 0, 600000, "OVER_TARGET"}, {"insufficient", goal, 0, 1000, "INSUFFICIENT_BALANCE"},
		{"completed", Goal{Status: "completed", TargetAmount: 2000000, SavedAmount: 2000000}, 25000000, 1000, "NOT_ALLOWED"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateDeposit(tc.g, Wallet{Money(tc.balance)}, Money(tc.amount))
			if tc.code == "" {
				if err != nil {
					t.Fatal(err)
				}
				return
			}
			var e *Error
			if !errors.As(err, &e) || e.Code != tc.code {
				t.Fatalf("want %s got %v", tc.code, err)
			}
		})
	}
}
