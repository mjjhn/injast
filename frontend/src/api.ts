export type Status = "active" | "completed";
export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  savedAmount: number;
  deadline: string;
  fundingSource: "wallet" | "monthly";
  status: Status;
  createdAt: string;
}
export interface Wallet {
  availableAmount: number;
}
export interface CreateGoal {
  name: string;
  targetAmount: number;
  deadline: string;
  fundingSource: "wallet" | "monthly";
  acceptedTerms: boolean;
}
export interface DepositResult {
  goal: Goal;
  wallet: Wallet;
}
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

const base = (import.meta.env.VITE_API_URL || "http://127.0.0.1:4000").replace(
  /\/$/,
  "",
);
async function request<T>(
  path: string,
  body?: unknown,
  key?: string,
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(`${base}/api${path}`, {
      method: body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok)
      throw new ApiError(
        response.status,
        data.code || "UNKNOWN",
        data.message || "درخواست انجام نشد.",
        data.field,
      );
    return data as T;
  } finally {
    window.clearTimeout(timeout);
  }
}
export const api = {
  wallet: () => request<Wallet>("/wallet"),
  goals: (status: Status) =>
    request<{ goals: Goal[] }>(`/goals?status=${status}`),
  goal: (id: string) =>
    request<{ goal: Goal }>(`/goals/${encodeURIComponent(id)}`),
  create: (body: CreateGoal) => request<{ goal: Goal }>("/goals", body),
  deposit: (id: string, amount: number, key: string) =>
    request<DepositResult>(
      `/goals/${encodeURIComponent(id)}/deposits`,
      { amount },
      key,
    ),
  cancel: (id: string) =>
    request<{ wallet: Wallet }>(`/goals/${encodeURIComponent(id)}/cancel`, {}),
};
export function errorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
}
