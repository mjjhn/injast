import { goalKeys } from "./queries";
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError, errorMessage } from "../api";

// Cancellation has no idempotency key. An uncertain response is reconciled with
// GETs; checking a result must never silently submit another cancellation.
export function useCancel(
  id: string,
  onDeleted: () => void,
  onCompleted: () => void,
) {
  const client = useQueryClient();
  const busy = useRef(false);
  const [isPending, setPending] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [message, setMessage] = useState("");
  async function reconcile() {
    const [goal, wallet, active, completed] = await Promise.all([
      api.goal(id).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
      api.wallet(),
      api.goals("active"),
      api.goals("completed"),
    ]);
    // Reads already in flight (including ones started during reconciliation)
    // must not replace these authoritative snapshots when they finish later.
    await Promise.all([
      client.cancelQueries({ queryKey: goalKeys.wallet, exact: true }),
      client.cancelQueries({ queryKey: goalKeys.lists }),
      client.cancelQueries({ queryKey: goalKeys.detail(id), exact: true }),
    ]);
    client.setQueryData(goalKeys.wallet, wallet);
    client.setQueryData(goalKeys.list("active"), active);
    client.setQueryData(goalKeys.list("completed"), completed);
    setUnknown(false);
    if (goal === null) {
      client.removeQueries({ queryKey: goalKeys.detail(id), exact: true });
      onDeleted();
    } else {
      client.setQueryData(goalKeys.detail(id), goal);
      if (goal.goal.status === "completed") onCompleted();
      else
        setMessage(
          "هدف همچنان فعال است. اطلاعات تازه شد؛ می‌توانی دوباره لغو کنی.",
        );
    }
  }
  async function run(send: boolean) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    let confirmed = false;
    try {
      if (send) {
        try {
          await api.cancel(id);
          confirmed = true;
        } catch (error) {
          if (
            error instanceof ApiError &&
            error.status < 500 &&
            error.status !== 404 &&
            !(error.status === 409 && error.code === "NOT_ALLOWED")
          ) {
            setMessage(errorMessage(error));
            return;
          }
        }
      }
      setUnknown(true);
      try {
        await reconcile();
      } catch {
        setUnknown(true);
        setMessage(
          confirmed
            ? "لغو ثبت شد؛ دریافت اطلاعات تازه ممکن نشد. نتیجه را بررسی کن."
            : "نتیجهٔ لغو هنوز مشخص نیست. با بررسی نتیجه، فقط وضعیت تازه دریافت می‌شود.",
        );
      }
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return {
    isPending,
    unknown,
    message,
    submit: () => void run(true),
    check: () => void run(false),
    reset: () => {
      if (!unknown && !busy.current) setMessage("");
    },
  };
}
