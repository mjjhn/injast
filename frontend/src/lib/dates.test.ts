import { expect, it } from "vitest";
import { dateBounds, fromISO, toISO } from "./dates";
it("uses 30 days and clamps 24 calendar months at month end", () => {
  expect(dateBounds("2024-02-29")).toEqual({
    min: "2024-03-30",
    max: "2026-02-28",
  });
  expect(dateBounds("2026-11-09")).toEqual({
    min: "2026-12-09",
    max: "2028-11-09",
  });
});
it("round trips calendar selections without UTC timezone drift", () =>
  expect(toISO(fromISO("2027-02-01"))).toBe("2027-02-01"));
