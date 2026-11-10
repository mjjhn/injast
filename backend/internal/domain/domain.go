// Package domain contains pure savings-goal rules and financial transitions.
package domain

import (
	"math"
	"strings"
	"time"
	_ "time/tzdata" // Keep Asia/Tehran available in minimal runtime images.
	"unicode/utf8"
)

type Money int64
type Status string
type FundingSource string

const (
	Active        Status        = "active"
	Completed     Status        = "completed"
	WalletSource  FundingSource = "wallet"
	MonthlySource FundingSource = "monthly"
)

type Goal struct {
	ID            string
	Name          string
	TargetAmount  Money
	SavedAmount   Money
	Deadline      string
	FundingSource FundingSource
	Status        Status
	CreatedAt     string
}
type Wallet struct {
	AvailableAmount Money
}
type DepositResult struct {
	Goal   Goal
	Wallet Wallet
}
type CreateInput struct {
	Name          string
	TargetAmount  Money
	Deadline      string
	FundingSource FundingSource
	AcceptedTerms bool
}
type Error struct {
	Code    string
	Message string
	Field   string
}

func (e *Error) Error() string { return e.Message }
func Validation(field, message string) *Error {
	return &Error{"VALIDATION", message, field}
}
func NotFound() *Error {
	return &Error{"NOT_FOUND", "هدف پیدا نشد.", ""}
}
func NotAllowed() *Error {
	return &Error{"NOT_ALLOWED", "این عملیات فقط برای هدف فعال امکان‌پذیر است.", ""}
}
func Conflict() *Error {
	return &Error{"IDEMPOTENCY_CONFLICT", "این کلید قبلاً برای واریز دیگری استفاده شده است.", ""}
}

var Tehran = mustLocation()

func mustLocation() *time.Location {
	loc, err := time.LoadLocation("Asia/Tehran")
	if err != nil {
		panic(err)
	}
	return loc
}
func Today(now time.Time) time.Time {
	n := now.In(Tehran)
	return time.Date(n.Year(), n.Month(), n.Day(), 0, 0, 0, 0, Tehran)
}
func DateBounds(now time.Time) (time.Time, time.Time) {
	today := Today(now)
	first := time.Date(today.Year()+2, today.Month(), 1, 0, 0, 0, 0, Tehran)
	last := first.AddDate(0, 1, -1).Day()
	day := today.Day()
	if day > last {
		day = last
	}
	return today.AddDate(0, 0, 30), time.Date(first.Year(), first.Month(), day, 0, 0, 0, 0, Tehran)
}
func ValidateCreate(in *CreateInput, now time.Time) error {
	in.Name = strings.TrimSpace(in.Name)
	n := utf8.RuneCountInString(in.Name)
	if n < 3 || n > 32 {
		return Validation("name", "نام هدف باید بین ۳ تا ۳۲ نویسه باشد.")
	}
	if in.TargetAmount < 500000 || in.TargetAmount > 200000000 {
		return Validation("targetAmount", "مبلغ هدف باید از ۵۰۰٬۰۰۰ تا ۲۰۰٬۰۰۰٬۰۰۰ ریال باشد.")
	}
	date, err := time.ParseInLocation("2006-01-02", in.Deadline, Tehran)
	min, max := DateBounds(now)
	if err != nil || date.Format("2006-01-02") != in.Deadline || date.Before(min) || date.After(max) {
		return Validation("deadline", "مهلت باید از ۳۰ روز تا ۲۴ ماه آینده باشد.")
	}
	if in.FundingSource != "wallet" && in.FundingSource != "monthly" {
		return Validation("fundingSource", "منبع تأمین را انتخاب کنید.")
	}
	if !in.AcceptedTerms {
		return Validation("acceptedTerms", "برای ساخت هدف، پذیرش این شرط لازم است.")
	}
	return nil
}
func ValidateDeposit(goal Goal, wallet Wallet, amount Money) error {
	if amount <= 0 {
		return Validation("amount", "مبلغ واریز باید عدد صحیح بیشتر از صفر باشد.")
	}
	if goal.Status != "active" {
		return NotAllowed()
	}
	if wallet.AvailableAmount < 0 || goal.SavedAmount < 0 || goal.SavedAmount > goal.TargetAmount {
		return &Error{Code: "INVALID_STATE", Message: "وضعیت مالی هدف معتبر نیست."}
	}
	if amount > goal.TargetAmount-goal.SavedAmount {
		return &Error{"OVER_TARGET", "مبلغ واریز از باقی‌ماندهٔ هدف بیشتر است.", "amount"}
	}
	if amount > wallet.AvailableAmount {
		return &Error{"INSUFFICIENT_BALANCE", "موجودی کیف پول کافی نیست.", "amount"}
	}
	return nil
}

// Deposit applies the pure financial transition without persistence or transport.
func Deposit(goal Goal, wallet Wallet, amount Money) (DepositResult, error) {
	if err := ValidateDeposit(goal, wallet, amount); err != nil {
		return DepositResult{}, err
	}
	goal.SavedAmount += amount
	wallet.AvailableAmount -= amount
	if goal.SavedAmount == goal.TargetAmount {
		goal.Status = Completed
	}
	return DepositResult{Goal: goal, Wallet: wallet}, nil
}
func Refund(goal Goal, wallet Wallet) (Wallet, error) {
	if goal.Status != Active {
		return Wallet{}, NotAllowed()
	}
	if goal.SavedAmount < 0 || wallet.AvailableAmount < 0 || wallet.AvailableAmount > Money(math.MaxInt64)-goal.SavedAmount {
		return Wallet{}, &Error{Code: "INVALID_STATE", Message: "وضعیت مالی هدف معتبر نیست."}
	}
	wallet.AvailableAmount += goal.SavedAmount
	return wallet, nil
}
