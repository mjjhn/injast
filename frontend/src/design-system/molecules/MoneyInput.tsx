import {
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type ComponentProps,
} from "react";
import { Input } from "../atoms/Input";
import { normalizeDigits, parseMoney } from "../../lib/money";

type Props = Omit<ComponentProps<"input">, "value" | "onChange" | "type"> & {
  value: string;
  onValueChange: (value: string) => void;
};
const digit = /[0-9۰-۹٠-٩]/;
function formatDigits(value: string) {
  return normalizeDigits(value)
    .replace(/[,٬]/g, "")
    .replace(/\B(?=(\d{3})+(?!\d))/g, "٬")
    .replace(/\d/g, (d) => String.fromCharCode(1776 + Number(d)));
}
function caretAfter(value: string, digits: number) {
  if (!digits) return 0;
  let count = 0;
  for (let i = 0; i < value.length; i++) {
    if (digit.test(value[i]) && ++count === digits) return i + 1;
  }
  return value.length;
}

/** Group only valid digit edits. Invalid pasted values remain visible and invalid. */
export function MoneyInput({ value, onValueChange, ref, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!);
  const selection = useRef<number | null>(null);
  const composing = useRef(false);
  const display = parseMoney(value) !== null ? formatDigits(value) : value;
  useLayoutEffect(() => {
    if (
      selection.current !== null &&
      document.activeElement === input.current
    ) {
      input.current?.setSelectionRange(selection.current, selection.current);
      selection.current = null;
    }
  });
  function update(raw: string, caret: number, strict = false) {
    const canFormat =
      /^[0-9۰-۹٠-٩,٬]*$/.test(raw) &&
      (!strict || raw === "" || parseMoney(raw) !== null) &&
      (value === "" ||
        parseMoney(value) !== null ||
        parseMoney(raw) !== null ||
        /^[0-9۰-۹٠-٩]*$/.test(raw));
    const next = canFormat ? formatDigits(raw) : raw;
    selection.current = canFormat
      ? caretAfter(
          next,
          [...raw.slice(0, caret)].filter((c) => digit.test(c)).length,
        )
      : caret;
    onValueChange(next);
    // A deletion of a formatting character can produce the same controlled value.
    if (next === value)
      input.current?.setSelectionRange(selection.current, selection.current);
  }
  return (
    <div className="amount-input">
      <Input
        {...props}
        ref={input}
        type="text"
        inputMode="numeric"
        dir="ltr"
        value={display}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          update(
            event.currentTarget.value,
            event.currentTarget.selectionStart ?? 0,
            true,
          );
        }}
        onChange={(event) => {
          const raw = event.target.value;
          if (composing.current) onValueChange(raw);
          else update(raw, event.target.selectionStart ?? raw.length);
        }}
        onPaste={(event) => {
          event.preventDefault();
          const pasted = event.clipboardData.getData("text").trim();
          const el = event.currentTarget;
          const start = el.selectionStart ?? 0,
            end = el.selectionEnd ?? start;
          if (parseMoney(pasted) === null) {
            // Do not turn 12,34, decimals or signed values into a different amount.
            const raw = display.slice(0, start) + pasted + display.slice(end);
            selection.current = start + pasted.length;
            onValueChange(raw);
            return;
          }
          const plain = normalizeDigits(pasted).replace(/[,٬]/g, "");
          update(
            display.slice(0, start) + plain + display.slice(end),
            start + plain.length,
          );
        }}
        onKeyDown={(event) => {
          props.onKeyDown?.(event);
          if (
            event.defaultPrevented ||
            event.altKey ||
            event.ctrlKey ||
            event.metaKey
          )
            return;
          const el = event.currentTarget,
            start = el.selectionStart ?? 0;
          if (el.selectionEnd !== start || parseMoney(display) === null) return;
          if (
            event.key === "Backspace" &&
            /[,٬]/.test(display[start - 1] ?? "")
          ) {
            event.preventDefault();
            update(
              display.slice(0, start - 2) + display.slice(start),
              start - 2,
            );
          } else if (
            event.key === "Delete" &&
            /[,٬]/.test(display[start] ?? "")
          ) {
            event.preventDefault();
            update(display.slice(0, start) + display.slice(start + 2), start);
          }
        }}
      />
      <span aria-hidden="true">ریال</span>
    </div>
  );
}
