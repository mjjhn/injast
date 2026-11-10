export interface DepositAttempt {
  goalId: string;
  amount: number;
  key: string;
}
const storageKey = (id: string) => `hadaf:deposit:${id}`;
export function loadAttempt(id: string): DepositAttempt | null {
  try {
    const raw = sessionStorage.getItem(storageKey(id));
    if (!raw) return null;
    const value = JSON.parse(raw) as DepositAttempt;
    return value.goalId === id &&
      Number.isSafeInteger(value.amount) &&
      value.amount > 0 &&
      typeof value.key === "string" &&
      value.key.length > 0
      ? value
      : null;
  } catch {
    return null;
  }
}
export function saveAttempt(value: DepositAttempt) {
  sessionStorage.setItem(storageKey(value.goalId), JSON.stringify(value));
}
export function clearAttempt(id: string) {
  sessionStorage.removeItem(storageKey(id));
}
