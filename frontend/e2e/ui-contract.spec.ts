import { test, expect } from "@playwright/test";

// Contract fixtures exist only in tests. The application has no mock transport.
const book = {
  id: "book",
  name: "کتاب",
  targetAmount: 2000000,
  savedAmount: 1500000,
  deadline: "2027-02-01",
  fundingSource: "wallet",
  status: "active",
  createdAt: "2026-11-01T00:00:00Z",
};
test("UI contract: list, empty, form calendar and detail against network fixtures", async ({
  page,
}) => {
  await page.route(
    `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api/**`,
    async (route) => {
      const path = new URL(route.request().url()).pathname;
      const data =
        path === "/api/wallet"
          ? { availableAmount: 25000000 }
          : path === "/api/goals/book"
            ? { goal: book }
            : {
                goals: route.request().url().includes("completed")
                  ? []
                  : [book],
              };
      await route.fulfill({ json: data });
    },
  );
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "کتاب", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "تمام‌شده" }).click();
  await expect(page.getByText("جای هدف‌های رسیده اینجاست")).toBeVisible();
  await page.getByRole("link", { name: "هدف جدید", exact: true }).click();
  await page
    .getByRole("button", { name: "مهلت رسیدن به هدف", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "انتخاب مهلت هدف" }),
  ).toBeVisible();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "ساخت هدف" })).toBeDisabled();
  await page.goto("/goals/book");
  await page.getByRole("button", { name: "افزودن پول" }).click();
  await expect(page.getByLabel("مبلغ واریز (ریال)")).toBeVisible();
  await page.getByLabel("مبلغ واریز (ریال)").fill("۶۰۰۰۰۰");
  await expect(
    page.getByRole("button", { name: "تأیید واریز" }),
  ).toBeDisabled();
  await page.getByLabel("مبلغ واریز (ریال)").fill("۵۰۰۰۰۰");
  await expect(page.getByRole("button", { name: "تأیید واریز" })).toBeEnabled();
});
