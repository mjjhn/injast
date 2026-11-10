import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { DateField } from "./DateField";
import { dateBounds } from "../../lib/dates";
function Field() {
  const [date, setDate] = useState("");
  return (
    <>
      <label htmlFor="deadline">تاریخ</label>
      <DateField
        value={date}
        onChange={setDate}
        onBlur={() => {}}
        aria-invalid={false}
      />
      <output>{date}</output>
    </>
  );
}
it("selects month and year inline; Escape backs out before closing and restores focus", async () => {
  const user = userEvent.setup();
  render(<Field />);
  await user.click(screen.getByRole("button", { name: "تاریخ" }));
  await user.click(screen.getByRole("button", { name: "انتخاب ماه" }));
  expect(
    within(screen.getByRole("group", { name: "ماه‌ها" })).getAllByRole(
      "button",
    ),
  ).toHaveLength(12);
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("grid")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "انتخاب سال" }));
  const years = within(
    screen.getByRole("group", { name: "سال‌ها" }),
  ).getAllByRole("button");
  expect(screen.getByText(/سال‌های مجاز:/)).toBeVisible();
  await user.click(years[years.length - 1]);
  expect(screen.getByRole("grid")).toBeVisible();
  expect(screen.getByRole("status")).toBeEmptyDOMElement();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "تاریخ" })).toHaveFocus();
});
it("selects an allowed ISO day and closes the panel", async () => {
  const user = userEvent.setup();
  render(<Field />);
  await user.click(screen.getByRole("button", { name: "تاریخ" }));
  const day = within(screen.getByRole("grid"))
    .getAllByRole("button")
    .find((b) => !(b as HTMLButtonElement).disabled)!;
  await user.click(day);
  const value = screen.getByRole("status").textContent!;
  expect(value >= dateBounds().min && value <= dateBounds().max).toBe(true);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
