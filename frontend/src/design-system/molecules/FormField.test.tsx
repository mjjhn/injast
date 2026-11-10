import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { FormField } from "./FormField";
import { Input } from "../atoms/Input";

it("connects the visible label, hint and validation error to its control", () => {
  render(
    <FormField
      id="name"
      label="نام هدف"
      hint="۳ تا ۳۲ نویسه"
      error="نام کوتاه است"
    >
      <Input />
    </FormField>,
  );
  const input = screen.getByRole("textbox", { name: "نام هدف" });
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAccessibleDescription("نام کوتاه است ۳ تا ۳۲ نویسه");
  expect(screen.getByRole("alert")).toHaveTextContent("نام کوتاه است");
});
