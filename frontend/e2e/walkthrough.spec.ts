import { test, expect } from "@playwright/test";

test.use({
  video: { mode: "on", size: { width: 360, height: 800 } },
  launchOptions: {
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    slowMo: 350,
  },
});
test("recorded real-API walkthrough: complete a goal and confirm cancellation", async ({
  page,
  request,
}) => {
  expect(
    (
      await request.post(
        `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api/reset`,
      )
    ).status(),
  ).toBe(200);
  await page.goto("/");
  await page.getByRole("heading", { name: "کتاب", exact: true }).click();
  await page.getByRole("button", { name: "افزودن پول" }).click();
  await page
    .getByLabel("مبلغ واریز (ریال)")
    .pressSequentially("۵۰۰۰۰۰", { delay: 80 });
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(page.getByText("این هدف تکمیل شده است")).toBeVisible();
  await page.getByRole("link", { name: "بازگشت" }).click();
  await page.getByRole("tab", { name: "تمام‌شده" }).click();
  await expect(
    page.getByRole("heading", { name: "کتاب", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "فعال", exact: true }).click();
  await page.getByRole("heading", { name: "سفر شمال", exact: true }).click();
  await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("برگشت‌پذیر نیست");
  await dialog.getByRole("button", { name: "لغو هدف", exact: true }).click();
  await expect(page.getByRole("heading", { name: "هدف‌های من" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "سفر شمال", exact: true }),
  ).toHaveCount(0);
});
