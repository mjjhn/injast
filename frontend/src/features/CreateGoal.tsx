import { goalKeys } from "./queries";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useLocation } from "react-router";
import { ArrowLeft, CalendarDays, Check, Target, Wallet } from "lucide-react";
import {
  api,
  ApiError,
  errorMessage,
  type CreateGoal as CreateInput,
} from "../api";
import { Button, FieldError, Input } from "../design-system/atoms";
import { DateField } from "../design-system/molecules/DateField";
import { ErrorState } from "../design-system/molecules/ErrorState";
import { FormField } from "../design-system/molecules/FormField";
import { MoneyInput } from "../design-system/molecules/MoneyInput";
import { Shell } from "../design-system/layout";
import { parseMoney } from "../lib/money";
import { validateGoal } from "../lib/validation";

const requiredFields: { key: keyof CreateInput; label: string; id: string }[] =
  [
    { key: "name", label: "نام هدف", id: "goal-name" },
    { key: "targetAmount", label: "مبلغ هدف", id: "target-amount" },
    { key: "deadline", label: "مهلت رسیدن به هدف", id: "deadline" },
    { key: "fundingSource", label: "منبع تأمین", id: "source-wallet" },
    { key: "acceptedTerms", label: "پذیرش شرط", id: "accepted-terms" },
  ];

export function CreateGoal() {
  const location = useLocation();
  const returnTo =
    location.state?.returnTo === "/?status=completed"
      ? "/?status=completed"
      : "/?status=active";
  const navigate = useNavigate(),
    client = useQueryClient();
  const [name, setName] = useState(""),
    [amount, setAmount] = useState(""),
    [deadline, setDeadline] = useState("");
  const [source, setSource] = useState<"wallet" | "monthly">("wallet"),
    [terms, setTerms] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({}),
    [serverErrors, setServerErrors] = useState<Record<string, string>>({});
  const value: CreateInput = {
    name: name.trim(),
    targetAmount: parseMoney(amount) ?? 0,
    deadline,
    fundingSource: source,
    acceptedTerms: terms,
  };
  const errors = validateGoal(value);
  const outstanding = requiredFields.filter((field) => errors[field.key]);
  const valid = outstanding.length === 0;
  const touch = (field: string) =>
    setTouched((old) => ({ ...old, [field]: true }));
  const clearServer = (field: string) =>
    setServerErrors((old) => {
      const next = { ...old };
      delete next[field];
      return next;
    });
  const fieldError = (field: keyof CreateInput) =>
    serverErrors[field] || (touched[field] ? errors[field] : undefined);
  const create = useMutation({
    mutationFn: api.create,
    onSuccess: async ({ goal }) => {
      await client.invalidateQueries({ queryKey: goalKeys.lists });
      navigate(`/goals/${goal.id}`, {
        replace: true,
        state: { created: true, returnTo },
      });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.field)
        setServerErrors({ [error.field]: error.message });
    },
  });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    setTouched({
      name: true,
      targetAmount: true,
      deadline: true,
      fundingSource: true,
      acceptedTerms: true,
    });
    if (valid && !create.isPending) {
      setServerErrors({});
      create.mutate(value);
    }
  }
  return (
    <Shell
      title="هدف جدید"
      back={returnTo}
      footer={
        <>
          {!valid && !create.isPending && (
            <div className="form-guidance">
              <p
                id="create-guidance"
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                برای ساخت هدف، این موارد را تکمیل یا اصلاح کن:{" "}
                {outstanding.map((field) => field.label).join("، ")}.
              </p>
              <Button
                type="button"
                variant="ghost"
                className="text-button"
                onClick={() => {
                  const field = document.getElementById(outstanding[0].id);
                  field?.focus({ preventScroll: true });
                  field?.scrollIntoView?.({ block: "center" });
                }}
              >
                رفتن به {outstanding[0].label}
                <ArrowLeft size={16} aria-hidden="true" />
              </Button>
            </div>
          )}
          <Button
            form="goal-form"
            type="submit"
            variant="primary"
            disabled={!valid || create.isPending}
            aria-describedby={
              !valid && !create.isPending ? "create-guidance" : undefined
            }
          >
            {create.isPending ? "در حال ساخت هدف…" : "ساخت هدف"}
            <ArrowLeft size={19} aria-hidden="true" />
          </Button>
        </>
      }
    >
      <div className="form-intro">
        <span className="intro-icon">
          <Target size={24} aria-hidden="true" />
        </span>
        <h2>برای چه چیزی پس‌انداز می‌کنی؟</h2>
        <p>یک نام، یک مبلغ و یک زمان برای رسیدن.</p>
      </div>
      <form
        id="goal-form"
        onSubmit={submit}
        noValidate
        aria-busy={create.isPending}
      >
        <fieldset className="goal-form form-fields" disabled={create.isPending}>
          <FormField
            id="goal-name"
            label="نام هدف"
            error={fieldError("name")}
            hint="۳ تا ۳۲ نویسه؛ چیزی که برایت مهم است."
          >
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                clearServer("name");
              }}
              onBlur={() => touch("name")}
              placeholder="مثلاً دوچرخه"
              autoComplete="off"
            />
          </FormField>
          <FormField
            id="target-amount"
            label={
              <>
                مبلغ هدف <span className="muted">(ریال)</span>
              </>
            }
            error={fieldError("targetAmount")}
            hint="از ۵۰۰٬۰۰۰ تا ۲۰۰٬۰۰۰٬۰۰۰ ریال"
          >
            <MoneyInput
              value={amount}
              onValueChange={(next) => {
                setAmount(next);
                clearServer("targetAmount");
              }}
              onBlur={() => touch("targetAmount")}
              placeholder="مثلاً ۱۰٬۰۰۰٬۰۰۰"
            />
          </FormField>
          <FormField
            id="deadline"
            label="مهلت رسیدن به هدف"
            error={fieldError("deadline")}
            hint="تقویم شمسی؛ از ۳۰ روز تا ۲۴ ماه آینده"
          >
            <DateField
              value={deadline}
              onChange={(next) => {
                setDeadline(next);
                clearServer("deadline");
              }}
              onBlur={() => touch("deadline")}
            />
          </FormField>
          <fieldset className="source-field">
            <legend>منبع تأمین</legend>
            <p className="hint">
              فقط برنامهٔ توست؛ برداشت خودکار انجام نمی‌شود.
            </p>
            <div className="source-options">
              {(["wallet", "monthly"] as const).map((option) => (
                <label
                  key={option}
                  className={
                    source === option
                      ? "source-option selected"
                      : "source-option"
                  }
                >
                  <Input
                    type="radio"
                    name="source"
                    id={`source-${option}`}
                    value={option}
                    checked={source === option}
                    onChange={() => {
                      setSource(option);
                      clearServer("fundingSource");
                    }}
                    aria-describedby={
                      fieldError("fundingSource") ? "source-error" : undefined
                    }
                  />
                  {option === "wallet" ? (
                    <Wallet size={19} aria-hidden="true" />
                  ) : (
                    <CalendarDays size={19} aria-hidden="true" />
                  )}
                  <span>
                    {option === "wallet" ? "کیف پول" : "پس‌انداز ماهانه"}
                  </span>
                  {source === option && <Check size={16} aria-hidden="true" />}
                </label>
              ))}
            </div>
            <FieldError id="source-error">
              {fieldError("fundingSource")}
            </FieldError>
          </fieldset>
          <div className="terms-block">
            <label>
              <Input
                type="checkbox"
                id="accepted-terms"
                checked={terms}
                onChange={(event) => {
                  setTerms(event.target.checked);
                  clearServer("acceptedTerms");
                }}
                onBlur={() => touch("acceptedTerms")}
                aria-describedby={
                  fieldError("acceptedTerms") ? "terms-error" : undefined
                }
              />
              <span>
                می‌پذیرم مبلغ ذخیره‌شده تا زمان لغو هدف، قابل برداشت آزاد نیست.
              </span>
            </label>
            <FieldError id="terms-error">
              {fieldError("acceptedTerms")}
            </FieldError>
          </div>
          {create.isError &&
            !(create.error instanceof ApiError && create.error.field) && (
              <>
                <ErrorState message={errorMessage(create.error)} />
                {(!(create.error instanceof ApiError) ||
                  create.error.status >= 500) && (
                  <p className="notice" role="status">
                    نتیجهٔ ساخت مشخص نیست؛ اطلاعات فرم حفظ شده است. پیش از ثبت
                    دوباره،{" "}
                    <Link to="/?status=active">فهرست هدف‌ها را بررسی کن</Link>.
                  </p>
                )}
              </>
            )}
        </fieldset>
      </form>
    </Shell>
  );
}
