import { expect, it } from "vitest";
import { validateGoal } from "./validation";
import { dateBounds } from "./dates";
const valid = () => ({
  name: "  دوچرخه  ",
  targetAmount: 500000,
  deadline: dateBounds().min,
  fundingSource: "wallet" as const,
  acceptedTerms: true,
});
it("accepts the inclusive minimums and Unicode characters", () =>
  expect(validateGoal(valid())).toEqual({}));
it("rejects boundaries, missing terms and invalid source", () => {
  expect(
    validateGoal({
      ...valid(),
      name: "اب",
      targetAmount: 500000.5,
      deadline: "2020-01-01",
      fundingSource: "invalid" as "wallet",
      acceptedTerms: false,
    }),
  ).toEqual(
    expect.objectContaining({
      name: expect.any(String),
      targetAmount: expect.any(String),
      deadline: expect.any(String),
      fundingSource: expect.any(String),
      acceptedTerms: expect.any(String),
    }),
  );
});
