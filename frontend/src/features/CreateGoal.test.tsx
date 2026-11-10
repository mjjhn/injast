import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { expect, it } from "vitest";
import { CreateGoal } from "./CreateGoal";

it("keeps submit disabled and shows a name validation message only after blur", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CreateGoal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const name = screen.getByLabelText("نام هدف");
  expect(
    screen.queryByText("نام هدف باید بین ۳ تا ۳۲ نویسه باشد."),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "ساخت هدف" })).toBeDisabled();
  await user.type(name, "اب");
  await user.tab();
  expect(
    screen.getByText("نام هدف باید بین ۳ تا ۳۲ نویسه باشد."),
  ).toBeVisible();
  await user.clear(name);
  await user.type(name, "دوچرخه");
  expect(
    screen.queryByText("نام هدف باید بین ۳ تا ۳۲ نویسه باشد."),
  ).not.toBeInTheDocument();
});

it("locks pending fields, retains rejected values and clears a corrected field error", async () => {
  const { api, ApiError } = await import("../api");
  const { vi } = await import("vitest");
  let reject!: (error: Error) => void;
  vi.spyOn(api, "create").mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const user = userEvent.setup();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      <MemoryRouter>
        <CreateGoal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await user.type(screen.getByLabelText("نام هدف"), "دوچرخه");
  await user.type(screen.getByLabelText("مبلغ هدف (ریال)"), "1000000");
  await user.click(screen.getByRole("button", { name: "مهلت رسیدن به هدف" }));
  const days = screen
    .getByRole("grid")
    .querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
  await user.click(days[0]);
  await user.click(screen.getByRole("checkbox"));
  await user.click(screen.getByRole("button", { name: "ساخت هدف" }));
  expect(screen.getByLabelText("نام هدف")).toBeDisabled();
  expect(screen.getByLabelText("مبلغ هدف (ریال)")).toBeDisabled();
  expect(
    screen.getByRole("button", { name: "مهلت رسیدن به هدف" }),
  ).toBeDisabled();
  expect(screen.getByRole("checkbox")).toBeDisabled();
  const { act } = await import("@testing-library/react");
  await act(async () =>
    reject(new ApiError(422, "VALIDATION_ERROR", "خطای نام از سرور", "name")),
  );
  expect(await screen.findByText("خطای نام از سرور")).toBeVisible();
  expect(screen.getByLabelText("نام هدف")).toHaveValue("دوچرخه");
  expect(screen.getByLabelText("مبلغ هدف (ریال)")).toHaveValue("۱٬۰۰۰٬۰۰۰");
  await user.type(screen.getByLabelText("نام هدف"), " نو");
  expect(screen.queryByText("خطای نام از سرور")).not.toBeInTheDocument();
});

it("explains all outstanding fields, focuses the first, and updates until the form is valid", async () => {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <CreateGoal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const submit = screen.getByRole("button", { name: "ساخت هدف" });
  expect(submit).toHaveAccessibleDescription(
    /نام هدف، مبلغ هدف، مهلت رسیدن به هدف، پذیرش شرط/,
  );
  // Fill everything except the untouched name: the disabled CTA must explain why.
  await user.type(screen.getByLabelText("مبلغ هدف (ریال)"), "1000000");
  await user.click(screen.getByRole("button", { name: "مهلت رسیدن به هدف" }));
  await user.click(
    screen
      .getByRole("grid")
      .querySelector<HTMLButtonElement>("button:not(:disabled)")!,
  );
  await user.click(screen.getByRole("checkbox"));
  expect(submit).toBeDisabled();
  expect(submit).toHaveAccessibleDescription(
    "برای ساخت هدف، این موارد را تکمیل یا اصلاح کن: نام هدف.",
  );
  expect(
    screen.queryByText("نام هدف باید بین ۳ تا ۳۲ نویسه باشد."),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "رفتن به نام هدف" }));
  expect(screen.getByLabelText("نام هدف")).toHaveFocus();
  await user.type(screen.getByLabelText("نام هدف"), "دوچرخه");
  expect(submit).toBeEnabled();
  expect(submit).not.toHaveAttribute("aria-describedby");
  expect(
    screen.queryByRole("button", { name: "رفتن به نام هدف" }),
  ).not.toBeInTheDocument();
  await user.clear(screen.getByLabelText("مبلغ هدف (ریال)"));
  await user.type(screen.getByLabelText("مبلغ هدف (ریال)"), "12");
  expect(submit).toBeDisabled();
  expect(submit).toHaveAccessibleDescription(
    "برای ساخت هدف، این موارد را تکمیل یا اصلاح کن: مبلغ هدف.",
  );
  await user.click(screen.getByRole("button", { name: "رفتن به مبلغ هدف" }));
  expect(screen.getByLabelText("مبلغ هدف (ریال)")).toHaveFocus();
});
