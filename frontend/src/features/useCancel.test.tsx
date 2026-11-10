import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { api, ApiError, type Goal, type Wallet } from "../api";
import { useCancel } from "./useCancel";
function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const deleted = vi.fn(),
    completed = vi.fn();
  const hook = renderHook(() => useCancel("trip", deleted, completed), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  vi.spyOn(api, "wallet").mockResolvedValue({ availableAmount: 33000000 });
  vi.spyOn(api, "goals").mockResolvedValue({ goals: [] });
  return { ...hook, client, deleted, completed };
}
it.each(["success", "lost", "missing"])(
  "reconciles %s cancellation with authoritative GETs",
  async (outcome) => {
    const hook = setup();
    const cancel = vi.spyOn(api, "cancel");
    if (outcome === "success")
      cancel.mockResolvedValue({ wallet: { availableAmount: 1 } });
    else
      cancel.mockRejectedValue(
        outcome === "missing"
          ? new ApiError(404, "NOT_FOUND", "missing")
          : new TypeError("lost"),
      );
    vi.spyOn(api, "goal").mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "missing"),
    );
    act(() => {
      hook.result.current.submit();
      hook.result.current.submit();
    });
    await waitFor(() => expect(hook.deleted).toHaveBeenCalledOnce());
    expect(cancel).toHaveBeenCalledOnce();
    expect(hook.client.getQueryData(["wallet"])).toEqual({
      availableAmount: 33000000,
    });
    expect(hook.result.current.unknown).toBe(false);
  },
);
it("checks an unknown result with GET only, including repeated read failures", async () => {
  const hook = setup();
  const cancel = vi
    .spyOn(api, "cancel")
    .mockRejectedValue(new TypeError("lost"));
  const goal = vi
    .spyOn(api, "goal")
    .mockRejectedValue(new TypeError("offline"));
  act(() => hook.result.current.submit());
  await waitFor(() => expect(hook.result.current.unknown).toBe(true));
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  act(() => hook.result.current.check());
  await waitFor(() => expect(goal).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  goal.mockRejectedValue(new ApiError(404, "NOT_FOUND", "missing"));
  act(() => hook.result.current.check());
  await waitFor(() => expect(hook.deleted).toHaveBeenCalledOnce());
  expect(cancel).toHaveBeenCalledOnce();
});
it.each(["active", "completed"] as const)(
  "handles a fresh %s goal after a lost response",
  async (status) => {
    const hook = setup();
    vi.spyOn(api, "cancel").mockRejectedValue(new TypeError("lost"));
    vi.spyOn(api, "goal").mockResolvedValue({
      goal: { id: "trip", status } as Goal,
    });
    act(() => hook.result.current.submit());
    await waitFor(() => expect(hook.result.current.isPending).toBe(false));
    expect(hook.deleted).not.toHaveBeenCalled();
    expect(hook.result.current.unknown).toBe(false);
    if (status === "completed") expect(hook.completed).toHaveBeenCalledOnce();
    else expect(hook.result.current.message).toContain("فعال");
  },
);
it("does not turn a confirmed cancellation with failed reads into another POST", async () => {
  const hook = setup();
  const cancel = vi
    .spyOn(api, "cancel")
    .mockResolvedValue({ wallet: { availableAmount: 33000000 } });
  vi.spyOn(api, "goal").mockRejectedValue(
    new ApiError(404, "NOT_FOUND", "missing"),
  );
  const wallet = vi
    .spyOn(api, "wallet")
    .mockRejectedValue(new TypeError("offline"));
  act(() => hook.result.current.submit());
  await waitFor(() =>
    expect(hook.result.current.message).toContain("لغو ثبت شد"),
  );
  wallet.mockResolvedValue({ availableAmount: 33000000 });
  act(() => hook.result.current.check());
  await waitFor(() => expect(hook.deleted).toHaveBeenCalledOnce());
  expect(cancel).toHaveBeenCalledOnce();
});

it("reconciles a NOT_ALLOWED conflict with a goal completed by another client", async () => {
  const hook = setup();
  hook.client.setQueryData(["goal", "trip"], {
    goal: { id: "trip", status: "active" } as Goal,
  });
  const cancel = vi
    .spyOn(api, "cancel")
    .mockRejectedValue(new ApiError(409, "NOT_ALLOWED", "هدف تکمیل شده است."));
  vi.spyOn(api, "goal").mockResolvedValue({
    goal: { id: "trip", status: "completed" } as Goal,
  });
  act(() => hook.result.current.submit());
  await waitFor(() => expect(hook.completed).toHaveBeenCalledOnce());
  expect(hook.client.getQueryData(["goal", "trip"])).toMatchObject({
    goal: { status: "completed" },
  });
  expect(hook.result.current.unknown).toBe(false);
  expect(cancel).toHaveBeenCalledOnce();
});

it("checks a conflict with failed reads using GET only", async () => {
  const hook = setup();
  const cancel = vi
    .spyOn(api, "cancel")
    .mockRejectedValue(new ApiError(409, "NOT_ALLOWED", "هدف تکمیل شده است."));
  const goal = vi
    .spyOn(api, "goal")
    .mockRejectedValue(new TypeError("offline"));
  act(() => hook.result.current.submit());
  await waitFor(() => expect(hook.result.current.unknown).toBe(true));
  await waitFor(() => expect(hook.result.current.isPending).toBe(false));
  goal.mockResolvedValue({ goal: { id: "trip", status: "completed" } as Goal });
  act(() => hook.result.current.check());
  await waitFor(() => expect(hook.completed).toHaveBeenCalledOnce());
  expect(cancel).toHaveBeenCalledOnce();
  expect(goal).toHaveBeenCalledTimes(2);
});

it("preserves definite validation errors without a cancellation retry", async () => {
  const hook = setup();
  const cancel = vi
    .spyOn(api, "cancel")
    .mockRejectedValue(new ApiError(400, "VALIDATION", "درخواست نامعتبر است."));
  const goal = vi.spyOn(api, "goal");
  act(() => hook.result.current.submit());
  await waitFor(() =>
    expect(hook.result.current.message).toBe("درخواست نامعتبر است."),
  );
  expect(hook.result.current.unknown).toBe(false);
  expect(goal).not.toHaveBeenCalled();
  expect(cancel).toHaveBeenCalledOnce();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each([
  ["before", "deleted"],
  ["during", "deleted"],
  ["before", "completed"],
  ["during", "completed"],
] as const)(
  "rejects stale queries started %s reconciliation of a %s goal",
  async (timing, status) => {
    const hook = setup();
    const freshGoal = { goal: { id: "trip", status: "completed" } as Goal };
    const staleGoal = { goal: { id: "trip", status: "active" } as Goal };
    const freshActive = { goals: [] as Goal[] };
    const freshCompleted = {
      goals: status === "completed" ? [freshGoal.goal] : [],
    };
    const walletRead = deferred<Wallet>();
    vi.spyOn(api, "cancel").mockResolvedValue({
      wallet: { availableAmount: 33000000 },
    });
    const goal = vi.spyOn(api, "goal");
    if (status === "deleted")
      goal.mockRejectedValue(new ApiError(404, "NOT_FOUND", "missing"));
    else goal.mockResolvedValue(freshGoal);
    const wallet = vi.spyOn(api, "wallet").mockReturnValue(walletRead.promise);
    vi.spyOn(api, "goals").mockImplementation(async (value) =>
      value === "active" ? freshActive : freshCompleted,
    );

    const staleReads = [
      { key: ["wallet"], value: { availableAmount: 25000000 } },
      { key: ["goals", "active"], value: { goals: [staleGoal.goal] } },
      { key: ["goals", "completed"], value: { goals: [] } },
      { key: ["goal", "trip"], value: staleGoal },
    ].map(({ key, value }) => ({ key, value, read: deferred<unknown>() }));
    function startOldQueries() {
      return staleReads.map(({ key, read }) =>
        hook.client
          .fetchQuery({
            queryKey: key,
            queryFn: () => read.promise,
          })
          .catch(() => undefined),
      ); // Cancellation of these retired reads is expected.
    }
    let oldQueries: Promise<unknown>[] = [];
    if (timing === "before") oldQueries = startOldQueries();
    act(() => hook.result.current.submit());
    await waitFor(() => expect(wallet).toHaveBeenCalledOnce());
    if (timing === "during") oldQueries = startOldQueries();
    walletRead.resolve({ availableAmount: 33000000 });
    await waitFor(() =>
      expect(
        status === "deleted" ? hook.deleted : hook.completed,
      ).toHaveBeenCalledOnce(),
    );

    await act(async () => {
      for (const { read, value } of staleReads) read.resolve(value);
      await Promise.all(oldQueries);
    });
    expect(hook.client.getQueryData(["wallet"])).toEqual({
      availableAmount: 33000000,
    });
    expect(hook.client.getQueryData(["goals", "active"])).toEqual(freshActive);
    expect(hook.client.getQueryData(["goals", "completed"])).toEqual(
      freshCompleted,
    );
    expect(hook.client.getQueryData(["goal", "trip"])).toEqual(
      status === "deleted" ? undefined : freshGoal,
    );
  },
);
