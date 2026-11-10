import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect } from "vitest";
import { MoneyInput } from "./MoneyInput";
import { parseMoney } from "../../lib/money";
function Field() {
  const [value, setValue] = useState("");
  return (
    <>
      <MoneyInput aria-label="مبلغ" value={value} onValueChange={setValue} />
      <output>{String(parseMoney(value))}</output>
    </>
  );
}
it.each(["1234567", "۱۲۳۴۵۶۷", "١٢٣٤٥٦٧"])(
  "groups typed digits %s without changing the amount",
  async (digits) => {
    const user = userEvent.setup();
    render(<Field />);
    await user.type(screen.getByRole("textbox"), digits);
    expect(screen.getByRole("textbox")).toHaveValue("۱٬۲۳۴٬۵۶۷");
    expect(screen.getByRole("status")).toHaveTextContent("1234567");
  },
);
it("preserves caret when inserting in the middle and deleting beside a separator", async () => {
  const user = userEvent.setup();
  render(<Field />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  await user.type(input, "12345");
  input.setSelectionRange(2, 2);
  await user.keyboard("9");
  expect(input).toHaveValue("۱۲۹٬۳۴۵");
  expect(input.selectionStart).toBe(3);
  input.setSelectionRange(4, 4);
  await user.keyboard("{Backspace}");
  expect(input).toHaveValue("۱۲٬۳۴۵");
  expect(input.selectionStart).toBe(2);
  await user.keyboard("{Delete}");
  expect(input).toHaveValue("۱٬۲۴۵");
  await user.clear(input);
  expect(input).toHaveValue("");
});
it.each(["12,34", "1.5", "۱٫۵", "-100", "1e6", "100 ریال"])(
  "does not repair invalid paste %s",
  async (raw) => {
    const user = userEvent.setup();
    render(<Field />);
    await user.click(screen.getByRole("textbox"));
    await user.paste(raw);
    expect(screen.getByRole("textbox")).toHaveValue(raw);
    expect(screen.getByRole("status")).toHaveTextContent("null");
  },
);
it("accepts grouped paste and selection replacement; rejects unsafe integers", async () => {
  const user = userEvent.setup();
  render(<Field />);
  const input = screen.getByRole("textbox") as HTMLInputElement;
  await user.click(input);
  await user.paste("۱۲٬۳۴۵");
  expect(input).toHaveValue("۱۲٬۳۴۵");
  input.setSelectionRange(0, input.value.length);
  await user.paste("٥٠٠٠٠");
  expect(input).toHaveValue("۵۰٬۰۰۰");
  expect(screen.getByRole("status")).toHaveTextContent("50000");
  fireEvent.change(input, { target: { value: "9007199254740992" } });
  expect(screen.getByRole("status")).toHaveTextContent("null");
});

it("keeps invalid grouping invalid on subsequent digit edits", async () => {
  const user = userEvent.setup();
  render(<Field />);
  const input = screen.getByRole("textbox");
  await user.click(input);
  await user.paste("1,2");
  await user.keyboard("3");
  expect(input).toHaveValue("1,23");
  expect(screen.getByRole("status")).toHaveTextContent("null");
});
