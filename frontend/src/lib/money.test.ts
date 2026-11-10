import { describe, expect, it } from "vitest";
import { normalizeDigits, parseMoney } from "./money";

describe("integer rial input", () => {
  it.each([
    ["۵۰۰٬۰۰۰", 500000],
    ["٥٠٠٠٠٠", 500000],
    ["500,000", 500000],
    [" ۱۲۳ ", 123],
    ["۰", 0],
    ["12", 12],
  ])("parses %s", (text, value) => expect(parseMoney(text)).toBe(value));
  it.each([
    "",
    "-1",
    "1.5",
    "۱٫۵",
    "12,34",
    "1e6",
    "+1",
    "100 ریال",
    "۱ ۰۰۰",
    "9007199254740992",
  ])("rejects without silently repairing %s", (text) =>
    expect(parseMoney(text)).toBeNull(),
  );
  it("normalizes both digit sets without changing punctuation", () =>
    expect(normalizeDigits("۱۲٣٬۴")).toBe("123٬4"));
});
