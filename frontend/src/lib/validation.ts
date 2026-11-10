import type { CreateGoal } from "../api";
import { dateBounds } from "./dates";

export function validateGoal(
  value: CreateGoal,
): Partial<Record<keyof CreateGoal, string>> {
  const errors: Partial<Record<keyof CreateGoal, string>> = {};
  const length = Array.from(value.name.trim()).length;
  if (length < 3 || length > 32)
    errors.name = "نام هدف باید بین ۳ تا ۳۲ نویسه باشد.";
  if (
    !Number.isSafeInteger(value.targetAmount) ||
    value.targetAmount < 500000 ||
    value.targetAmount > 200000000
  )
    errors.targetAmount = "مبلغ هدف باید از ۵۰۰٬۰۰۰ تا ۲۰۰٬۰۰۰٬۰۰۰ ریال باشد.";
  const { min, max } = dateBounds();
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value.deadline) ||
    value.deadline < min ||
    value.deadline > max
  )
    errors.deadline = "مهلت باید از ۳۰ روز تا ۲۴ ماه آینده باشد.";
  if (!["wallet", "monthly"].includes(value.fundingSource))
    errors.fundingSource = "منبع تأمین را انتخاب کنید.";
  if (!value.acceptedTerms)
    errors.acceptedTerms = "برای ساخت هدف، پذیرش این شرط لازم است.";
  return errors;
}
