import { queryOptions } from "@tanstack/react-query";
import { api, type Status } from "../api";

// One key vocabulary for reads and mutation reconciliation.
export const goalKeys = {
  wallet: ["wallet"] as const,
  lists: ["goals"] as const,
  list: (status: Status) => ["goals", status] as const,
  detail: (id: string) => ["goal", id] as const,
};

export const walletQuery = () =>
  queryOptions({ queryKey: goalKeys.wallet, queryFn: api.wallet });
export const goalsQuery = (status: Status) =>
  queryOptions({
    queryKey: goalKeys.list(status),
    queryFn: () => api.goals(status),
  });
export const goalQuery = (id: string) =>
  queryOptions({
    queryKey: goalKeys.detail(id),
    queryFn: () => api.goal(id),
  });
