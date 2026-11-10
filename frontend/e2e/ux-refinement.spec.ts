import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const api = `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api`;
const captures =
  process.env.E2E_SCREENSHOTS || "../artifacts/screenshots/ux-refinement";
const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page, request }) => {
  const errors: string[] = [];
  browserErrors.set(page, errors);
  // Keep errors in the test process so navigation/reload cannot erase evidence.
  await page.exposeFunction("recordUiError", (message: string) =>
    errors.push(message),
  );
  await page.addInitScript(() => {
    window.addEventListener("error", (event) => {
      const report = (
        window as typeof window & {
          recordUiError: (message: string) => Promise<void>;
        }
      ).recordUiError;
      void report(event.message);
    });
  });
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await request.post(`${api}/reset`)).ok()).toBeTruthy();
  await mkdir(captures, { recursive: true });
});
test.afterEach(async ({ page }) => {
  expect(browserErrors.get(page)).toEqual([]);
});
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(
    await page
      .locator(".page-content")
      .evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
}
test("partial deposits close/reset the form, restore focus and get a new key", async ({
  page,
  request,
}) => {
  const keys: string[] = [];
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().endsWith("/deposits"))
      keys.push(req.headers()["idempotency-key"]);
  });
  await page.goto("/goals/book");
  const add = page.getByRole("button", { name: "افزودن پول" });
  await add.click();
  const input = page.getByLabel("مبلغ واریز (ریال)");
  await expect(input).toBeFocused();
  await input.pressSequentially("50000");
  await expect(input).toHaveValue("۵۰٬۰۰۰");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(input).toHaveCount(0);
  await expect(add).toBeFocused();
  await expect(page.getByText("واریز با موفقیت ثبت شد.")).toBeVisible();
  await page.screenshot({ path: `${captures}/deposit-success.png` });
  await add.click();
  await expect(input).toHaveValue("");
  await expect(page.getByText("واریز با موفقیت ثبت شد.")).toHaveCount(0);
  await input.fill("۵۰۰۰۰");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(add).toBeFocused();
  expect(keys).toHaveLength(2);
  expect(keys[0]).not.toBe(keys[1]);
  expect(
    (await (await request.get(`${api}/goals/book`)).json()).goal.savedAmount,
  ).toBe(1600000);
  await add.click();
  await input.fill("12345");
  await page.getByRole("button", { name: "بستن فرم واریز" }).click();
  await expect(add).toBeFocused();
  await add.click();
  await expect(input).toHaveValue("");
});
test("confirmed money stays confirmed when refresh fails; retry only reads", async ({
  page,
  request,
}) => {
  let committed = false,
    posts = 0;
  await page.route("**/api/goals/book", async (route) => {
    if (committed) await route.abort();
    else await route.continue();
  });
  await page.route("**/api/goals/book/deposits", async (route) => {
    posts++;
    const result = await route.fetch();
    committed = true;
    await route.fulfill({ response: result });
  });
  await page.goto("/goals/book");
  await page.getByRole("button", { name: "افزودن پول" }).click();
  await page.getByLabel("مبلغ واریز (ریال)").fill("50000");
  await page.getByRole("button", { name: "تأیید واریز" }).click();
  await expect(
    page.getByText("واریز ثبت شد؛ دریافت اطلاعات تازهٔ هدف ناموفق بود."),
  ).toBeVisible();
  await expect(page.getByLabel("مبلغ واریز (ریال)")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "افزودن پول" })).toBeDisabled();
  committed = false;
  await page.getByRole("button", { name: "تلاش دوباره" }).click();
  await expect(page.getByRole("button", { name: "افزودن پول" })).toBeEnabled();
  expect(posts).toBe(1);
  expect(
    (await (await request.get(`${api}/wallet`)).json()).availableAmount,
  ).toBe(24950000);
});
test("completed tab survives detail/back and cancellation focuses the safe action", async ({
  page,
  request,
}) => {
  await request.post(`${api}/goals/book/deposits`, {
    data: { amount: 500000 },
    headers: { "Idempotency-Key": "ux-complete" },
  });
  await page.goto("/?status=completed");
  await page.getByRole("heading", { name: "کتاب", exact: true }).click();
  await page.getByRole("link", { name: "بازگشت" }).click();
  await expect(page.getByRole("tab", { name: "تمام‌شده" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.goto("/goals/trip");
  const cancel = page.getByRole("button", { name: "لغو هدف", exact: true });
  await cancel.click();
  await expect(
    page.getByRole("button", { name: "انصراف", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(cancel).toBeFocused();
});
for (const viewport of [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 640 },
  { width: 1440, height: 900 },
  { width: 800, height: 420 },
]) {
  test(`calendar and all page surfaces fit ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "کتاب", exact: true }),
    ).toBeVisible();
    await noOverflow(page);
    await page.getByRole("link", { name: "هدف جدید", exact: true }).click();
    await page.getByLabel("نام هدف").fill("هدفبلندبدونفاصلهبرایآزموننمایش");
    await page.getByLabel("مبلغ هدف (ریال)").fill("200000000");
    await expect(page.getByLabel("مبلغ هدف (ریال)")).toHaveValue("۲۰۰٬۰۰۰٬۰۰۰");
    await noOverflow(page);
    const trigger = page.getByRole("button", {
      name: "مهلت رسیدن به هدف",
      exact: true,
    });
    await trigger.click();
    const panel = page.getByRole("dialog", { name: "انتخاب مهلت هدف" });
    async function checkPanel() {
      const box = (await panel.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
      expect(
        await panel.evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
    }
    await checkPanel();
    await page.screenshot({
      path: `${captures}/calendar-days-${viewport.width}.png`,
    });
    await page.getByRole("button", { name: "انتخاب ماه", exact: true }).click();
    await checkPanel();
    await expect(
      page.getByRole("group", { name: "ماه‌ها" }).getByRole("button"),
    ).toHaveCount(12);
    await page.screenshot({
      path: `${captures}/calendar-months-${viewport.width}.png`,
    });
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "انتخاب ماه", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "انتخاب سال", exact: true }).click();
    await checkPanel();
    await page.screenshot({
      path: `${captures}/calendar-years-${viewport.width}.png`,
    });
    await page
      .getByRole("group", { name: "سال‌ها" })
      .getByRole("button")
      .last()
      .click();
    await expect(page.getByRole("grid")).toBeVisible();
    await page.getByRole("button", { name: "انتخاب ماه", exact: true }).click();
    await page
      .getByRole("group", { name: "ماه‌ها" })
      .locator("button:not(:disabled)")
      .last()
      .click();
    await page
      .getByRole("grid")
      .locator("button:not(:disabled)")
      .last()
      .click();
    await expect(panel).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await trigger.click();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.goto("/goals/trip");
    await page.getByRole("button", { name: "افزودن پول" }).click();
    await page.getByLabel("مبلغ واریز (ریال)").fill("1234567");
    await noOverflow(page);
    await page.getByRole("button", { name: "بستن فرم واریز" }).click();
    await page.getByRole("button", { name: "لغو هدف", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "انصراف", exact: true }),
    ).toBeInViewport();
    await page.screenshot({ path: `${captures}/cancel-${viewport.width}.png` });
  });
}

test("keyboard calendar selection, outside dismissal and enlarged text remain usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/goals/new");
  const trigger = page.getByRole("button", {
    name: "مهلت رسیدن به هدف",
    exact: true,
  });
  await trigger.click();
  await expect(
    page.getByRole("button", { name: "انتخاب ماه", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  const selected = page
    .getByRole("group", { name: "ماه‌ها" })
    .locator('button[aria-pressed="true"]');
  await expect(selected).toBeFocused();
  await page.keyboard.press("Enter");
  const day = page.getByRole("grid").locator("button:not(:disabled)").first();
  await day.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page.getByRole("heading", { name: "هدف جدید", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Emulate text-only enlargement; this is separate from physical-device keyboard QA.
  await page.evaluate(() => {
    const nodes = document.querySelectorAll<HTMLElement>(
      "h1,h2,p,label,button,input,legend",
    );
    const sizes = [...nodes].map(
      (el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const,
    );
    for (const [el, size] of sizes)
      el.style.setProperty("font-size", `${size * 2}px`, "important");
  });
  await noOverflow(page);
  await expect(
    page.getByRole("button", { name: "ساخت هدف", exact: true }),
  ).toBeInViewport();
  await page.screenshot({ path: `${captures}/create-text-200.png` });
});

test("long names and large amounts fit list and detail with enlarged text", async ({
  page,
  request,
}) => {
  const deadline = (await (await request.get(`${api}/goals/book`)).json()).goal
    .deadline;
  const created = await request.post(`${api}/goals`, {
    data: {
      name: "ب".repeat(32),
      targetAmount: 200000000,
      deadline,
      fundingSource: "wallet",
      acceptedTerms: true,
    },
  });
  expect(created.ok()).toBeTruthy();
  const goal = (await created.json()).goal;
  expect(
    (
      await request.post(`${api}/goals/${goal.id}/deposits`, {
        data: { amount: 24000000 },
        headers: { "Idempotency-Key": "large-ui" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.setViewportSize({ width: 320, height: 640 });
  for (const path of ["/", `/goals/${goal.id}`]) {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "ب".repeat(32), level: 2 }),
    ).toBeVisible();
    await noOverflow(page);
    await page.evaluate(() => {
      const nodes = document.querySelectorAll<HTMLElement>(
        "h1,h2,p,label,button,input,legend,span,strong,bdi",
      );
      const sizes = [...nodes].map(
        (el) => [el, parseFloat(getComputedStyle(el).fontSize)] as const,
      );
      for (const [el, size] of sizes)
        el.style.setProperty("font-size", `${size * 2}px`, "important");
    });
    await noOverflow(page);
    await page.screenshot({
      path: `${captures}/${path === "/" ? "list" : "detail"}-long-text-200.png`,
    });
  }
});
