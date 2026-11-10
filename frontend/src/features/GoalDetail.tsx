import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CircleHelp,
  Target,
  BadgeCheck,
  Plus,
  Wallet,
  X,
} from "lucide-react";
import { errorMessage } from "../api";
import {
  Badge,
  Button,
  IconButton,
  Loading,
  Money,
  Toast,
} from "../design-system/atoms";
import { ErrorState } from "../design-system/molecules/ErrorState";
import { FormField } from "../design-system/molecules/FormField";
import { Shell } from "../design-system/layout";
import { Progress } from "./components/GoalProgress";
import { CancelGoalModal } from "./components/CancelGoalModal";
import { formatMoney, parseMoney } from "../lib/money";
import { formatDate } from "../lib/dates";
import { MoneyInput } from "../design-system/molecules/MoneyInput";
import { loadAttempt } from "../lib/attempt";
import { useDeposit } from "./useDeposit";

import { goalQuery as goalQueryOptions, walletQuery } from "./queries";

export function GoalDetail({ id }: { id: string }) {
  const location = useLocation();
  const goalQuery = useQuery(goalQueryOptions(id));
  const wallet = useQuery(walletQuery());
  const actionRef = useRef<HTMLButtonElement>(null);
  const completedRef = useRef<HTMLSpanElement>(null);
  const focusAfterSuccess = useRef(false);
  const [createdNotice, setCreatedNotice] = useState(!!location.state?.created);
  const returnTo =
    location.state?.returnTo === "/?status=completed"
      ? "/?status=completed"
      : "/?status=active";
  const [initialAttempt] = useState(() => loadAttempt(id));
  const [editing, setEditing] = useState(!!initialAttempt);
  const [amount, setAmount] = useState(
    initialAttempt ? String(initialAttempt.amount) : "",
  );
  const [touched, setTouched] = useState(false);
  const deposit = useDeposit(id, () => {
    setEditing(false);
    setAmount("");
    setTouched(false);
    setCreatedNotice(false);
    focusAfterSuccess.current = true;
  });
  const goal = goalQuery.data?.goal;
  const value = parseMoney(amount);
  const remaining = goal ? goal.targetAmount - goal.savedAmount : 0;
  const amountError =
    value === null || value <= 0
      ? "مبلغ را به‌صورت عدد صحیح بیشتر از صفر وارد کنید."
      : value > remaining
        ? "مبلغ از باقی‌ماندهٔ هدف بیشتر است."
        : wallet.data && value > wallet.data.availableAmount
          ? "موجودی کیف پول برای این مبلغ کافی نیست."
          : "";
  const unknown = !!deposit.attempt && !deposit.isPending;
  const showDeposit =
    (goal?.status === "active" && editing) || !!deposit.attempt;
  const active = goal?.status === "active";
  useEffect(() => {
    if (focusAfterSuccess.current && !deposit.isPending) {
      const target =
        goalQuery.isError || wallet.isError
          ? document.querySelector<HTMLButtonElement>(
              "#main-content .error-state button",
            )
          : active
            ? actionRef.current
            : completedRef.current;
      target?.focus();
      focusAfterSuccess.current = false;
    }
  }, [active, deposit.isPending, goalQuery.isError, wallet.isError]);
  function openDeposit() {
    deposit.resetFeedback();
    setAmount("");
    setTouched(false);
    setEditing(true);
  }
  function closeDeposit() {
    setEditing(false);
    setAmount("");
    setTouched(false);
    deposit.resetFeedback();
    requestAnimationFrame(() => actionRef.current?.focus());
  }
  const submit = () => {
    setTouched(true);
    if (deposit.attempt) deposit.submit(deposit.attempt.amount);
    else if (value !== null && !amountError) deposit.submit(value);
  };
  const footer =
    goal || deposit.attempt || deposit.confirmed ? (
      <>
        {deposit.confirmed && (
          <Toast status="success">واریز با موفقیت ثبت شد.</Toast>
        )}
        {deposit.isPending ? (
          <Button variant="primary" disabled>
            {deposit.confirmed
              ? "در حال به‌روزرسانی اطلاعات…"
              : "در حال بررسی واریز…"}
          </Button>
        ) : deposit.attempt ? (
          <Button variant="primary" onClick={submit}>
            <CircleHelp size={19} aria-hidden="true" />
            بررسی نتیجهٔ واریز قبلی
          </Button>
        ) : active ? (
          editing ? (
            <Button
              form="deposit-form"
              type="submit"
              variant="primary"
              disabled={
                !!amountError ||
                !wallet.data ||
                wallet.isError ||
                goalQuery.isError
              }
            >
              تأیید واریز
              <ArrowLeft size={19} aria-hidden="true" />
            </Button>
          ) : (
            <Button
              ref={actionRef}
              variant="primary"
              onClick={openDeposit}
              disabled={goalQuery.isError || wallet.isError || !wallet.data}
            >
              <Plus size={20} aria-hidden="true" />
              افزودن پول
            </Button>
          )
        ) : (
          <span ref={completedRef} tabIndex={-1} className="completed-footer">
            <Check size={20} aria-hidden="true" />
            {goal ? "این هدف تکمیل شده است" : "نتیجهٔ واریز دریافت شد"}
          </span>
        )}
      </>
    ) : undefined;
  return (
    <Shell title={goal?.name || "جزئیات هدف"} back={returnTo} footer={footer}>
      {goalQuery.isPending && <Loading />}
      {goalQuery.isError && (
        <ErrorState
          message={
            deposit.confirmed
              ? "واریز ثبت شد؛ دریافت اطلاعات تازهٔ هدف ناموفق بود."
              : errorMessage(goalQuery.error)
          }
          retry={() => {
            void goalQuery.refetch();
          }}
        />
      )}
      {goal && (
        <>
          {createdNotice && goal.savedAmount === 0 && (
            <p role="status" className="notice">
              هدفت ساخته شد؛ حالا اولین قدم را بردار.
            </p>
          )}
          <section className="detail-card">
            <div className="detail-title">
              <span className="goal-symbol">
                {active ? (
                  <Target size={25} aria-hidden="true" />
                ) : (
                  <BadgeCheck size={25} aria-hidden="true" />
                )}
              </span>
              <Badge>{active ? "در مسیر رسیدن" : "هدف تکمیل شده"}</Badge>
            </div>
            <h2>{goal.name}</h2>
            <span className="muted">تا امروز کنار گذاشتی</span>
            <Money value={goal.savedAmount} className="hero-money" />
            <p className="target-caption">
              از {formatMoney(goal.targetAmount)}
            </p>
            <Progress goal={goal} />
          </section>
          <section className="facts-card" aria-label="اطلاعات هدف">
            <div>
              <span>باقی‌مانده تا هدف</span>
              <Money value={remaining} />
            </div>
            <div>
              <span>
                <CalendarDays size={16} aria-hidden="true" />
                مهلت هدف
              </span>
              <strong>{formatDate(goal.deadline)}</strong>
            </div>
            <div>
              <span>
                <Wallet size={16} aria-hidden="true" />
                منبع تأمین
              </span>
              <strong>
                {goal.fundingSource === "wallet"
                  ? "کیف پول"
                  : "پس‌انداز ماهانه"}
              </strong>
            </div>
          </section>
          {wallet.isPending ? (
            <Loading label="در حال دریافت موجودی…" />
          ) : wallet.isError ? (
            <ErrorState
              message={
                deposit.confirmed
                  ? "واریز ثبت شد؛ دریافت موجودی تازه ناموفق بود."
                  : errorMessage(wallet.error)
              }
              retry={() => {
                void wallet.refetch();
              }}
            />
          ) : (
            <div className="available-row">
              <span>
                <Wallet size={18} aria-hidden="true" />
                موجودی قابل استفاده
              </span>
              <Money value={wallet.data.availableAmount} />
            </div>
          )}
        </>
      )}
      {showDeposit && (
        <section className="deposit-card">
          <div className="section-heading">
            <h2>{deposit.attempt ? "پیگیری واریز" : "چقدر کنار می‌گذاری؟"}</h2>
            {!deposit.attempt && (
              <IconButton aria-label="بستن فرم واریز" onClick={closeDeposit}>
                <X size={18} aria-hidden="true" />
              </IconButton>
            )}
          </div>
          {deposit.attempt ? (
            <div className="pending-summary">
              <Money value={deposit.attempt.amount} />
              <p>
                {deposit.isPending
                  ? "در حال دریافت نتیجه از سرور هستیم."
                  : "نتیجهٔ این واریز هنوز مشخص نیست. با بررسی دوباره، همان درخواست پیگیری می‌شود و پول دوباره کم نمی‌شود."}
              </p>
            </div>
          ) : (
            <form
              id="deposit-form"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
              noValidate
            >
              <FormField
                id="deposit-amount"
                label={
                  <>
                    مبلغ واریز <span className="muted">(ریال)</span>
                  </>
                }
                error={touched ? amountError : undefined}
                hint={`حداکثر ${formatMoney(Math.min(remaining, wallet.data?.availableAmount || 0))}`}
              >
                <MoneyInput
                  autoFocus
                  value={amount}
                  onValueChange={setAmount}
                  onFocus={(event) =>
                    event.currentTarget.scrollIntoView?.({ block: "nearest" })
                  }
                  onBlur={() => setTouched(true)}
                  placeholder="مبلغ را وارد کن"
                />
              </FormField>
            </form>
          )}
          {deposit.isError && !unknown && (
            <ErrorState message={errorMessage(deposit.error)} />
          )}
          {deposit.storageError && (
            <ErrorState message={deposit.storageError} />
          )}
        </section>
      )}
      {active && goal && (
        <CancelGoalModal
          goal={goal}
          returnTo={returnTo}
          disabled={!!deposit.attempt || deposit.isPending}
        />
      )}
    </Shell>
  );
}
