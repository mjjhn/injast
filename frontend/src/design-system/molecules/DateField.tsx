import { Button } from "../atoms/Button";
import { useEffect, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { DayPicker, faIR, getDateLib } from "@daypicker/persian";
import {
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react";
import { dateBounds, formatDate, fromISO, toISO } from "../../lib/dates";
import { formatNumber } from "../../lib/money";
import "@daypicker/react/style.css";
const calendar = getDateLib({ locale: faIR });
const noCaption = () => <></>;
type View = "days" | "months" | "years";
export function DateField({
  value,
  onChange,
  onBlur,
  id = "deadline",
  "aria-invalid": invalid = false,
  "aria-describedby": errorId,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("days");
  const bounds = dateBounds();
  const first = calendar.startOfMonth(fromISO(bounds.min));
  const last = calendar.startOfMonth(fromISO(bounds.max));
  const [month, setMonth] = useState(() =>
    calendar.startOfMonth(fromISO(value || bounds.min)),
  );
  const monthButton = useRef<HTMLButtonElement>(null),
    yearButton = useRef<HTMLButtonElement>(null);
  const choices = useRef<HTMLDivElement>(null);
  const year = calendar.getYear(month),
    monthIndex = calendar.getMonth(month);
  const minYear = calendar.getYear(first),
    maxYear = calendar.getYear(last);
  const years = Array.from(
    { length: maxYear - minYear + 1 },
    (_, i) => minYear + i,
  );
  const yearRangeHint = `سال‌های مجاز: ${formatNumber(minYear).replace(/٬/g, "")} تا ${formatNumber(maxYear).replace(/٬/g, "")}`;
  const inRange = (date: Date) => date >= first && date <= last;
  function showDays(target: Date, origin: "months" | "years") {
    setMonth(target < first ? first : target > last ? last : target);
    setView("days");
    requestAnimationFrame(() =>
      (origin === "months" ? monthButton : yearButton).current?.focus(),
    );
  }
  useEffect(() => {
    if (view !== "days") {
      const target =
        choices.current?.querySelector<HTMLButtonElement>(
          'button[aria-pressed="true"]:not(:disabled)',
        ) ??
        choices.current?.querySelector<HTMLButtonElement>(
          "button:not(:disabled)",
        );
      target?.focus();
    }
  }, [view]);
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setMonth(calendar.startOfMonth(fromISO(value || bounds.min)));
          setView("days");
        } else onBlur();
      }}
    >
      <Popover.Trigger asChild>
        <Button
          variant="ghost"
          id={id}
          type="button"
          className={`date-trigger ${invalid ? "invalid" : ""}`}
          aria-describedby={errorId}
          aria-invalid={invalid}
        >
          <span>{value ? formatDate(value) : "انتخاب تاریخ"}</span>
          <CalendarDays size={19} aria-hidden="true" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className="calendar-positioner"
          sideOffset={8}
          collisionPadding={12}
          align="center"
          dir="rtl"
          aria-label="انتخاب مهلت هدف"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            monthButton.current?.focus();
          }}
          onEscapeKeyDown={(event) => {
            if (view !== "days") {
              event.preventDefault();
              showDays(month, view);
            }
          }}
        >
          <div className="calendar-popover" data-view={view}>
            <div className="calendar-header">
              {view === "days" ? (
                <>
                  <Button
                    variant="ghost"
                    type="button"
                    className="calendar-nav"
                    aria-label="ماه قبل"
                    disabled={!inRange(calendar.addMonths(month, -1))}
                    onClick={() => setMonth(calendar.addMonths(month, -1))}
                  >
                    <ChevronRight size={18} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    ref={monthButton}
                    className="calendar-caption"
                    aria-label="انتخاب ماه"
                    onClick={() => setView("months")}
                  >
                    {calendar.format(month, "LLLL")}
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    ref={yearButton}
                    className="calendar-caption"
                    aria-label="انتخاب سال"
                    onClick={() => setView("years")}
                  >
                    {formatNumber(year).replace(/٬/g, "")}
                    <ChevronDown size={14} aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    type="button"
                    className="calendar-nav"
                    aria-label="ماه بعد"
                    disabled={!inRange(calendar.addMonths(month, 1))}
                    onClick={() => setMonth(calendar.addMonths(month, 1))}
                  >
                    <ChevronLeft size={18} aria-hidden="true" />
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    type="button"
                    className="calendar-nav"
                    aria-label="بازگشت به روزها"
                    onClick={() => showDays(month, view)}
                  >
                    <ArrowRight size={18} aria-hidden="true" />
                  </Button>
                  <h2>
                    {view === "months"
                      ? `ماه‌های ${formatNumber(year).replace(/٬/g, "")}`
                      : "انتخاب سال شمسی"}
                  </h2>
                </>
              )}
            </div>
            {view === "days" ? (
              <DayPicker
                mode="single"
                locale={faIR}
                dir="rtl"
                selected={value ? fromISO(value) : undefined}
                month={month}
                onMonthChange={setMonth}
                startMonth={first}
                endMonth={last}
                hideNavigation
                components={{ MonthCaption: noCaption }}
                disabled={{
                  before: fromISO(bounds.min),
                  after: fromISO(bounds.max),
                }}
                onSelect={(day) => {
                  if (day) {
                    onChange(toISO(day));
                    setOpen(false);
                    onBlur();
                  }
                }}
              />
            ) : (
              <div
                className="calendar-choices"
                ref={choices}
                role="group"
                aria-label={view === "months" ? "ماه‌ها" : "سال‌ها"}
              >
                {(view === "months"
                  ? Array.from({ length: 12 }, (_, i) => i)
                  : years
                ).map((item) => {
                  const target = calendar.newDate(
                    view === "months" ? year : item,
                    view === "months" ? item : monthIndex,
                    1,
                  );
                  return (
                    <Button
                      variant="ghost"
                      type="button"
                      key={item}
                      disabled={view === "months" && !inRange(target)}
                      aria-pressed={
                        view === "months" ? item === monthIndex : item === year
                      }
                      onClick={() => showDays(target, view)}
                    >
                      {view === "months"
                        ? calendar.format(target, "LLLL")
                        : formatNumber(item).replace(/٬/g, "")}
                    </Button>
                  );
                })}
              </div>
            )}
            <p className="calendar-hint">
              {view === "years" ? yearRangeHint : "از ۳۰ روز تا ۲۴ ماه آینده"}
            </p>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
