import { useRef, useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Modal } from "./Modal";
import { Button } from "../atoms/Button";

function Confirmation({ busy = false }: { busy?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={trigger} onClick={() => setOpen(true)}>
        باز کردن تأیید
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="تأیید لغو"
        description="هدف حذف می‌شود."
        busy={busy}
        initialFocusRef={safeAction}
        onReturnFocus={() => trigger.current?.focus()}
        footer={
          <Button
            ref={safeAction}
            disabled={busy}
            onClick={() => setOpen(false)}
          >
            انصراف
          </Button>
        }
      />
    </>
  );
}

it("focuses the safe action and dismisses by the close icon with focus restored", async () => {
  const user = userEvent.setup();
  render(<Confirmation />);
  const trigger = screen.getByRole("button", { name: "باز کردن تأیید" });
  await user.click(trigger);
  expect(
    screen.getByRole("dialog", { name: "تأیید لغو" }),
  ).toHaveAccessibleDescription("هدف حذف می‌شود.");
  expect(screen.getByRole("button", { name: "انصراف" })).toHaveFocus();
  await user.click(screen.getByRole("button", { name: "بستن" }));
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
});

it("prevents keyboard and close-button dismissal while the outcome is locked", async () => {
  const user = userEvent.setup();
  const view = render(<Confirmation busy />);
  await user.click(screen.getByRole("button", { name: "باز کردن تأیید" }));
  expect(screen.getByRole("button", { name: "بستن" })).toBeDisabled();
  await user.keyboard("{Escape}");
  expect(screen.getByRole("dialog")).toBeVisible();
  view.rerender(<Confirmation busy={false} />);
  await user.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("button", { name: "باز کردن تأیید" })).toHaveFocus();
});
