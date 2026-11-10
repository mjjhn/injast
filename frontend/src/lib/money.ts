export function normalizeDigits(input: string): string {
  return input
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 1776))
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 1632));
}
export function parseMoney(input: string): number | null {
  const normalized = normalizeDigits(input.trim());
  // Accept plain digits, or correctly grouped thousands. Never strip arbitrary punctuation.
  if (!/^(?:\d+|\d{1,3}(?:[,٬]\d{3})+)$/.test(normalized)) return null;
  const value = Number(normalized.replace(/[,٬]/g, ""));
  return Number.isSafeInteger(value) ? value : null;
}
const numbers = new Intl.NumberFormat("fa-IR");
export const formatNumber = (value: number) => numbers.format(value);
export const formatMoney = (value: number) => `${formatNumber(value)} ریال`;
