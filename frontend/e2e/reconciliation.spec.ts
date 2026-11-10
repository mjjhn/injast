import { test, expect } from "@playwright/test";
const api = `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api`;
test.beforeEach(async ({ request }) => {
  expect((await request.post(`${api}/reset`)).ok()).toBeTruthy();
});
for (const reply of ["lost", "404", "success"] as const) {
  test(`cancel ${reply} then unavailable reads recovers using GET only`, async ({
    page,
    request,
  }) => {
    let sent = 0,
      unavailable = false;
    await page.route("**/api/goals/trip", async (route) => {
      if (unavailable) await route.abort();
      else await route.continue();
    });
    await page.route("**/api/goals/trip/cancel", async (route) => {
      sent++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      unavailable = true;
      if (reply === "lost") await route.abort();
      else if (reply === "404")
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ code: "NOT_FOUND", message: "هدف پیدا نشد." }),
        });
      else await route.fulfill({ response });
    });
    await page.goto("/goals/trip");
    await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "لغو هدف", exact: true }).click();
    await expect(
      dialog.getByRole("button", { name: "بررسی نتیجه", exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "انصراف", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole("button", { name: "بررسی نتیجه", exact: true })
      .click();
    await expect(
      dialog.getByRole("button", { name: "بررسی نتیجه", exact: true }),
    ).toBeEnabled();
    expect(sent).toBe(1);
    unavailable = false;
    await dialog
      .getByRole("button", { name: "بررسی نتیجه", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "هدف‌های من", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "سفر شمال", exact: true }),
    ).toHaveCount(0);
    expect(sent).toBe(1);
    expect(
      (await (await request.get(`${api}/wallet`)).json()).availableAmount,
    ).toBe(33000000);
  });
}
test("lost cancel that did not reach server returns to fresh active state", async ({
  page,
  request,
}) => {
  let posts = 0;
  await page.route("**/api/goals/trip/cancel", async (route) => {
    posts++;
    await route.abort();
  });
  await page.goto("/goals/trip");
  await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "لغو هدف", exact: true }).click();
  await expect(dialog.getByText(/هدف همچنان فعال است/)).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "لغو هدف", exact: true }),
  ).toBeEnabled();
  await dialog.getByRole("button", { name: "انصراف", exact: true }).click();
  expect(posts).toBe(1);
  expect(
    (await (await request.get(`${api}/wallet`)).json()).availableAmount,
  ).toBe(25000000);
});
test("unknown create preserves form and offers list inspection without auto retry", async ({
  page,
  request,
}) => {
  let posts = 0;
  await page.route("**/api/goals", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    posts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    await route.abort();
  });
  await page.goto("/goals/new");
  await page.getByLabel("نام هدف").fill("آزمون ساخت");
  await page.getByLabel("مبلغ هدف (ریال)").fill("500000");
  await page
    .getByRole("button", { name: "مهلت رسیدن به هدف", exact: true })
    .click();
  await page.getByRole("grid").locator("button:not(:disabled)").first().click();
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "ساخت هدف", exact: true }).click();
  await expect(page.getByText(/نتیجهٔ ساخت مشخص نیست/)).toBeVisible();
  await expect(page.getByLabel("نام هدف")).toHaveValue("آزمون ساخت");
  expect(posts).toBe(1);
  await page.getByRole("link", { name: "فهرست هدف‌ها را بررسی کن" }).click();
  await expect(
    page.getByRole("heading", { name: "آزمون ساخت", exact: true }),
  ).toBeVisible();
  expect(
    (
      await (await request.get(`${api}/goals?status=active`)).json()
    ).goals.filter((g: { name: string }) => g.name === "آزمون ساخت"),
  ).toHaveLength(1);
});

test("real API: cancellation conflict reconciles completion by another client", async ({
  page,
  request,
}) => {
  await page.goto("/goals/book");
  await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const deposit = await request.post(`${api}/goals/book/deposits`, {
    headers: { "Idempotency-Key": "cancel-conflict-completion" },
    data: { amount: 500000 },
  });
  expect(deposit.status()).toBe(200);
  const conflict = page.waitForResponse((response) =>
    response.url().endsWith("/api/goals/book/cancel"),
  );
  await dialog.getByRole("button", { name: "لغو هدف", exact: true }).click();
  expect((await conflict).status()).toBe(409);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("این هدف تکمیل شده است")).toBeVisible();
  await expect(page.getByRole("button", { name: "افزودن پول" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "لغو هدف", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".available-row")).toContainText("۲۴٬۵۰۰٬۰۰۰");
});

test("real API: a delayed pre-cancel wallet response cannot hide the refund", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator(".wallet-card")).toContainText("۲۵٬۰۰۰٬۰۰۰");
  let releaseOld!: () => void;
  let markReady!: () => void;
  const release = new Promise<void>((done) => {
    releaseOld = done;
  });
  const ready = new Promise<void>((done) => {
    markReady = done;
  });
  let holdNext = true;
  await page.route("**/api/wallet", async (route) => {
    if (!holdNext) {
      await route.continue();
      return;
    }
    holdNext = false;
    const response = await route.fetch();
    expect((await response.json()).availableAmount).toBe(25000000);
    markReady();
    await release;
    await route.fulfill({ response });
  });
  try {
    await page
      .getByRole("link")
      .filter({
        has: page.getByRole("heading", { name: "سفر شمال", exact: true }),
      })
      .click();
    await ready;
    await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "لغو هدف", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "هدف‌های من", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".wallet-card")).toContainText("۳۳٬۰۰۰٬۰۰۰");
    const lateRead = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/wallet") && response.status() === 200,
    );
    releaseOld();
    await lateRead;
    // Allow the released HTTP response and resulting React notification to paint.
    await page.evaluate(
      () =>
        new Promise<void>((done) =>
          requestAnimationFrame(() => requestAnimationFrame(() => done())),
        ),
    );
    await expect(page.locator(".wallet-card")).toContainText("۳۳٬۰۰۰٬۰۰۰");
    expect(
      (await (await request.get(`${api}/wallet`)).json()).availableAmount,
    ).toBe(33000000);
  } finally {
    releaseOld();
  }
});
