import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { expect, it, vi } from "vitest";
import { api, ApiError, type DepositResult } from "../api";
import { loadAttempt, saveAttempt } from "../lib/attempt";
import { useDeposit } from "./useDeposit";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const response = {
  goal: { id: "book" },
  wallet: { availableAmount: 24500000 },
} as DepositResult;
it("keeps key and payload after a lost response and reload, then replays exactly once", async () => {
  const spy = vi
    .spyOn(api, "deposit")
    .mockRejectedValueOnce(new TypeError("lost response"))
    .mockResolvedValueOnce(response);
  const first = renderHook(() => useDeposit("book"), { wrapper });
  act(() => first.result.current.submit(500000));
  await waitFor(() => expect(first.result.current.isError).toBe(true));
  const stored = loadAttempt("book")!;
  expect(stored.amount).toBe(500000);
  expect(stored.key).toBeTruthy();
  first.unmount();
  const second = renderHook(() => useDeposit("book"), { wrapper });
  act(() => {
    second.result.current.submit(999);
    second.result.current.submit(999);
  });
  await waitFor(() => expect(second.result.current.isSuccess).toBe(true));
  expect(spy).toHaveBeenCalledTimes(2);
  expect(spy.mock.calls[0]).toEqual(["book", 500000, stored.key]);
  expect(spy.mock.calls[1]).toEqual(spy.mock.calls[0]);
  expect(loadAttempt("book")).toBeNull();
});
it("clears a definitively rejected attempt so the next amount gets a new key", async () => {
  const spy = vi
    .spyOn(api, "deposit")
    .mockRejectedValueOnce(new ApiError(422, "OVER_TARGET", "بیش از هدف"))
    .mockResolvedValueOnce(response);
  const hook = renderHook(() => useDeposit("book"), { wrapper });
  act(() => hook.result.current.submit(600000));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(loadAttempt("book")).toBeNull();
  act(() => hook.result.current.submit(500000));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(spy.mock.calls[0][2]).not.toBe(spy.mock.calls[1][2]);
});
it("retains a pre-existing attempt on an ambiguous server failure", async () => {
  saveAttempt({ goalId: "book", amount: 500000, key: "persisted-key" });
  vi.spyOn(api, "deposit").mockRejectedValue(
    new ApiError(500, "INTERNAL", "خطای سرور"),
  );
  const hook = renderHook(() => useDeposit("book"), { wrapper });
  act(() => hook.result.current.submit(1000));
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(loadAttempt("book")?.key).toBe("persisted-key");
});
it("does not send money if the retry identity cannot be persisted", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  const spy = vi.spyOn(api, "deposit");
  const hook = renderHook(() => useDeposit("book"), { wrapper });
  act(() => hook.result.current.submit(500000));
  expect(hook.result.current.storageError).toBeTruthy();
  expect(spy).not.toHaveBeenCalled();
});

it("confirms before reconciliation finishes and never reclassifies failed reads as a failed transfer", async () => {
  const client = new QueryClient();
  let failRead!: (error: Error) => void;
  vi.spyOn(client, "invalidateQueries")
    .mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          failRead = reject;
        }),
    )
    .mockResolvedValue(undefined);
  vi.spyOn(api, "deposit").mockResolvedValue(response);
  const confirmed = vi.fn();
  const hook = renderHook(() => useDeposit("book", confirmed), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  act(() => hook.result.current.submit(50000));
  await waitFor(() => expect(confirmed).toHaveBeenCalledOnce());
  expect(hook.result.current.confirmed).toBe(true);
  expect(loadAttempt("book")).toBeNull();
  expect(hook.result.current.isPending).toBe(true);
  await act(async () => failRead(new TypeError("read unavailable")));
  await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
  expect(hook.result.current.isError).toBe(false);
});
