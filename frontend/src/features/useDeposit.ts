import { goalKeys } from "./queries";
import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type DepositResult } from "../api";
import {
  clearAttempt,
  loadAttempt,
  saveAttempt,
  type DepositAttempt,
} from "../lib/attempt";

export function useDeposit(id: string, onConfirmed?: () => void) {
  const client = useQueryClient();
  const [attempt, setAttempt] = useState(() => loadAttempt(id));
  const [storageError, setStorageError] = useState("");
  const busy = useRef(false);
  const [confirmed, setConfirmed] = useState(false);
  const mutation = useMutation<DepositResult, Error, DepositAttempt>({
    mutationFn: (value) => api.deposit(value.goalId, value.amount, value.key),
    onSuccess: async () => {
      clearAttempt(id);
      setAttempt(null);
      setConfirmed(true);
      onConfirmed?.();
      // A failed read must never turn a confirmed transfer into a retryable mutation.
      await Promise.allSettled([
        client.invalidateQueries(
          { queryKey: goalKeys.wallet },
          { throwOnError: true },
        ),
        client.invalidateQueries(
          { queryKey: goalKeys.lists },
          { throwOnError: true },
        ),
        client.invalidateQueries(
          { queryKey: goalKeys.detail(id) },
          { throwOnError: true },
        ),
      ]);
    },
    onError: (error) => {
      // A definitive 4xx did not mutate money. Network/timeout/5xx remain ambiguous.
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500
      ) {
        clearAttempt(id);
        setAttempt(null);
      }
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  function submit(amount: number) {
    if (busy.current || mutation.isPending) return;
    const value = attempt || { goalId: id, amount, key: crypto.randomUUID() };
    try {
      saveAttempt(value);
    } catch {
      setStorageError(
        "ذخیرهٔ امن تلاش واریز در این مرورگر ممکن نیست. دسترسی ذخیره‌سازی را بررسی کنید.",
      );
      return;
    }
    setStorageError("");
    setAttempt(value);
    busy.current = true;
    mutation.mutate(value);
  }
  function resetFeedback() {
    setConfirmed(false);
    setStorageError("");
    mutation.reset();
  }
  return {
    attempt,
    submit,
    storageError,
    confirmed,
    resetFeedback,
    ...mutation,
  };
}
