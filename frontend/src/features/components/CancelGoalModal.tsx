import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { Trash2 } from "lucide-react";
import type { Goal } from "../../api";
import { Button } from "../../design-system/atoms";
import { ErrorState } from "../../design-system/molecules/ErrorState";
import { Modal } from "../../design-system/primitives";
import { formatMoney } from "../../lib/money";
import { useCancel } from "../useCancel";

export function CancelGoalModal({
  goal,
  returnTo,
  disabled,
}: {
  goal: Goal;
  returnTo: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const safeAction = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const cancel = useCancel(
    goal.id,
    () => {
      setOpen(false);
      navigate(returnTo, { replace: true });
    },
    () => setOpen(false),
  );
  const locked = cancel.isPending || cancel.unknown;
  return (
    <>
      <Button
        ref={trigger}
        variant="danger-soft"
        className="cancel-action"
        disabled={disabled}
        onClick={() => {
          cancel.reset();
          setOpen(true);
        }}
      >
        <Trash2 size={17} aria-hidden="true" />
        لغو هدف
      </Button>
      <Modal
        open={open}
        onOpenChange={setOpen}
        title="از این هدف منصرف شدی؟"
        busy={locked}
        closeLabel="بستن تأیید لغو"
        initialFocusRef={safeAction}
        onReturnFocus={() => trigger.current?.focus()}
        description={
          <>
            با لغو هدف «{goal.name}»، مبلغ{" "}
            <strong>{formatMoney(goal.savedAmount)}</strong> به موجودی کیف پولت
            برمی‌گردد. هدف حذف می‌شود و این کار برگشت‌پذیر نیست.
          </>
        }
        footer={
          <>
            <Button
              ref={safeAction}
              disabled={locked}
              onClick={() => setOpen(false)}
            >
              انصراف
            </Button>
            <Button
              variant="danger"
              disabled={cancel.isPending}
              onClick={cancel.unknown ? cancel.check : cancel.submit}
            >
              {cancel.isPending
                ? "در حال بررسی…"
                : cancel.unknown
                  ? "بررسی نتیجه"
                  : "لغو هدف"}
            </Button>
          </>
        }
      >
        {cancel.message && <ErrorState message={cancel.message} />}
      </Modal>
    </>
  );
}
