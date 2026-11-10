import { test, expect, type APIRequestContext } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const api = `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api`;
const captures = process.env.E2E_SCREENSHOTS || "../artifacts/screenshots";
async function reset(request: APIRequestContext) {
  expect((await request.post(`${api}/reset`)).ok()).toBeTruthy();
}
test.beforeEach(async ({ request }) => {
  await reset(request);
  await mkdir(captures, { recursive: true });
});

test("real API: create with Persian date picker and Persian amount", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "کتاب", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: "هدف جدید", exact: true }).click();
  await expect(page.getByRole("button", { name: "ساخت هدف" })).toBeDisabled();
  await page.getByLabel("نام هدف").fill("دوچرخه");
  await page.getByLabel("مبلغ هدف (ریال)").fill("۱۰٬۰۰۰٬۰۰۰");
  await page
    .getByRole("button", { name: "مهلت رسیدن به هدف", exact: true })
    .click();
  await page
    .getByRole("grid")
    .locator("button:not([disabled])")
    .first()
    .click();
  await page.getByRole("radio", { name: "پس‌انداز ماهانه" }).check();
  await page.getByRole("checkbox").check();
  await page.screenshot({ path: `${captures}/create-mobile.png` });
  await page.getByRole("button", { name: "ساخت هدف", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "دوچرخه", level: 2 }),
  ).toBeVisible();
  const goals = (await (await request.get(`${api}/goals?status=active`)).json())
    .goals;
  expect(
    goals.find((g: { name: string }) => g.name === "دوچرخه"),
  ).toMatchObject({
    targetAmount: 10000000,
    savedAmount: 0,
    fundingSource: "monthly",
    status: "active",
  });
});

test("real API: deposit completes book and reconciles wallet and tabs", async ({
  page,
  request,
}) => {
  await page.goto("/goals/book");
  await page.getByRole("button", { name: "افزودن پول" }).click();
  await page.getByLabel("مبلغ واریز (ریال)").fill("٥٠٠٠٠٠");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(page.getByText("این هدف تکمیل شده است")).toBeVisible();
  await expect(page.getByRole("button", { name: "افزودن پول" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "لغو هدف", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await request.get(`${api}/wallet`)).json()).availableAmount,
  ).toBe(24500000);
  await page.screenshot({ path: `${captures}/completed-mobile.png` });
  await page.getByRole("link", { name: "بازگشت" }).click();
  await page.getByRole("tab", { name: "تمام‌شده" }).click();
  await expect(
    page.getByRole("heading", { name: "کتاب", exact: true }),
  ).toBeVisible();
});

test("real API: cancel requires confirmation, refunds once and removes goal", async ({
  page,
  request,
}) => {
  await page.goto("/goals/trip");
  await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("برگشت‌پذیر نیست");
  await page.screenshot({ path: `${captures}/cancel-mobile.png` });
  await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
  expect((await request.get(`${api}/goals/trip`)).status()).toBe(200);
  await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
  await dialog.getByRole("button", { name: "لغو هدف", exact: true }).click();
  await expect(page.getByRole("heading", { name: "هدف‌های من" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "سفر شمال", exact: true }),
  ).toHaveCount(0);
  expect(
    (await (await request.get(`${api}/wallet`)).json()).availableAmount,
  ).toBe(33000000);
  expect((await request.get(`${api}/goals/trip`)).status()).toBe(404);
});

test("real API: lost committed response survives reload and retries the identical key", async ({
  page,
  request,
}) => {
  const keys: string[] = [];
  let lose = true;
  await page.route("**/api/goals/trip/deposits", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    keys.push(route.request().headers()["idempotency-key"]);
    if (lose) {
      lose = false;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    } else await route.continue();
  });
  await page.goto("/goals/trip");
  await page.getByRole("button", { name: "افزودن پول" }).click();
  await page.getByLabel("مبلغ واریز (ریال)").fill("۱۰۰۰");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(
    page.getByRole("button", { name: "بررسی نتیجهٔ واریز قبلی" }),
  ).toBeEnabled();
  await page.reload();
  await page.getByRole("button", { name: "بررسی نتیجهٔ واریز قبلی" }).click();
  await expect(page.getByText("واریز با موفقیت ثبت شد.")).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(
    (await (await request.get(`${api}/wallet`)).json()).availableAmount,
  ).toBe(24999000);
});

test("real API: displays authoritative OVER_TARGET and INSUFFICIENT_BALANCE after stale reads", async ({
  page,
  request,
}) => {
  await page.goto("/goals/book");
  await page.getByRole("button", { name: "افزودن پول" }).click();
  expect(
    (
      await request.post(`${api}/goals/book/deposits`, {
        data: { amount: 400000 },
        headers: { "Idempotency-Key": "other-book" },
      })
    ).status(),
  ).toBe(200);
  await page.getByLabel("مبلغ واریز (ریال)").fill("500000");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "مبلغ واریز از باقی‌ماندهٔ هدف بیشتر است.",
  );
  await reset(request);
  await page.goto("/goals/trip");
  await page.getByRole("button", { name: "افزودن پول" }).click();
  expect(
    (
      await request.post(`${api}/goals/laptop/deposits`, {
        data: { amount: 25000000 },
        headers: { "Idempotency-Key": "other-wallet" },
      })
    ).status(),
  ).toBe(200);
  await page.getByLabel("مبلغ واریز (ریال)").fill("1000");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "موجودی کیف پول کافی نیست.",
  );
  await page.screenshot({ path: `${captures}/server-error-mobile.png` });
});

test("real API: empty tabs, unavailable API and explicit retry", async ({
  page,
  request,
}) => {
  await page.goto("/?status=completed");
  await expect(page.getByText("جای هدف‌های رسیده اینجاست")).toBeVisible();
  for (const id of ["book", "trip", "laptop"])
    expect((await request.post(`${api}/goals/${id}/cancel`)).status()).toBe(
      200,
    );
  await page.getByRole("tab", { name: "فعال", exact: true }).click();
  await expect(page.getByText("اولین قدم، یک هدف تازه است")).toBeVisible();
  let fail = true;
  await page.route(/\/api\/goals\?status=active$/, async (route) => {
    if (fail) {
      await route.abort();
    } else await route.continue();
  });
  await page.reload();
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByRole("alert")).toBeVisible();
  fail = false;
  await panel.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(page.getByText("اولین قدم، یک هدف تازه است")).toBeVisible();
});

test("real API: mobile and desktop layout, keyboard tabs and focus", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "کتاب", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: `${captures}/goals-mobile.png` });
  await page.getByRole("tab", { name: "فعال", exact: true }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: "تمام‌شده" })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  const footer = page.getByRole("link", { name: "هدف جدید", exact: true });
  await expect(footer).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: `${captures}/goals-desktop.png` });
  const shell = await page.locator(".app-shell").boundingBox();
  expect(shell?.width).toBe(360);
  expect(shell?.x).toBe(540);
});
