import { test, expect, type Locator, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const api = `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api`;
const captures = path.join(
  process.env.E2E_SCREENSHOTS || "../artifacts/screenshots/appearance-contract",
  "contract",
);
const evidence = path.join(
  path.dirname(
    process.env.PLAYWRIGHT_JSON_OUTPUT_NAME ||
      "../artifacts/evidence/appearance-contract-playwright.json",
  ),
  "appearance-contract",
);
const viewports = [
  { width: 320, height: 640 },
  { width: 360, height: 800 },
  { width: 390, height: 640 },
  { width: 1440, height: 900 },
  { width: 800, height: 420 },
];

async function corners(locator: Locator) {
  const radii = await locator.evaluateAll((nodes) =>
    nodes.map((node) => {
      const css = getComputedStyle(node);
      return [
        css.borderTopLeftRadius,
        css.borderTopRightRadius,
        css.borderBottomRightRadius,
        css.borderBottomLeftRadius,
      ];
    }),
  );
  expect(radii.length).toBeGreaterThan(0);
  for (const value of radii)
    expect(value).toEqual(["12px", "12px", "12px", "12px"]);
}
async function css(locator: Locator, property: string, value: string) {
  await expect(locator).toHaveCSS(property, value);
}
async function layout(page: Page) {
  const measured = await page.evaluate(() => {
    const box = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {
      width: innerWidth,
      height: innerHeight,
      app: box(".app-shell"),
      main: box(".page-content"),
      top: box(".topbar"),
      footer: box(".action-footer"),
      overflow:
        document.documentElement.scrollWidth > innerWidth ||
        document.querySelector(".page-content")!.scrollWidth >
          document.querySelector(".page-content")!.clientWidth,
    };
  });
  expect(measured.app.width).toBeCloseTo(Math.min(360, measured.width), 0);
  expect(
    Math.abs(measured.app.x - (measured.width - measured.app.width) / 2),
  ).toBeLessThan(1);
  expect(measured.main.top).toBeGreaterThanOrEqual(measured.top.bottom - 1);
  expect(measured.main.bottom).toBeLessThanOrEqual(measured.footer.top + 1);
  expect(measured.footer.bottom).toBeLessThanOrEqual(measured.height + 1);
  expect(measured.overflow).toBe(false);
  await css(page.locator(".page-content"), "padding-left", "16px");
  await css(page.locator(".page-content"), "padding-right", "16px");
  await corners(page.locator(".app-shell"));
  for (const control of await page
    .locator(".action-footer .button,.topbar button")
    .all()) {
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
}
async function moneyInput(page: Page, input: Locator) {
  await css(input, "padding-left", "52px");
  await css(input, "font-size", "16px");
  const inputBox = (await input.boundingBox())!;
  const unit = await input.locator("..").locator("span").boundingBox();
  expect(unit).not.toBeNull();
  expect(
    Math.abs(unit!.y + unit!.height / 2 - (inputBox.y + inputBox.height / 2)),
  ).toBeLessThan(1);
  expect(unit!.x).toBeGreaterThan(inputBox.x);
  expect(unit!.x + unit!.width).toBeLessThanOrEqual(inputBox.x + 52 - 4);
  await corners(input);
  await expect(input).toBeInViewport();
  const textFits = await input.evaluate((node: HTMLInputElement) => {
    const css = getComputedStyle(node),
      canvas = document.createElement("canvas");
    const context = canvas.getContext("2d")!;
    context.font = `${css.fontWeight} ${css.fontSize} ${css.fontFamily}`;
    return (
      context.measureText(node.value).width <=
      node.clientWidth -
        parseFloat(css.paddingLeft) -
        parseFloat(css.paddingRight)
    );
  });
  expect(textFits).toBe(true);
}
async function focusRing(locator: Locator) {
  await locator.focus();
  // :focus-visible follows input modality. Exercise a real keyboard round-trip,
  // including when a dialog was opened with a pointer immediately beforehand.
  await locator.page().keyboard.press("Tab");
  await locator.page().keyboard.press("Shift+Tab");
  await expect(locator).toBeFocused();
  await css(locator, "outline-offset", "4px");
  await css(locator, "outline-width", "3px");
  const fits = await locator.evaluate((node) => {
    const rect = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    const ring =
      parseFloat(style.outlineWidth) + parseFloat(style.outlineOffset);
    let ancestor = node.parentElement;
    while (ancestor) {
      const overflow = getComputedStyle(ancestor);
      if (
        /(hidden|auto|scroll|clip)/.test(
          `${overflow.overflowX} ${overflow.overflowY}`,
        )
      ) {
        const clip = ancestor.getBoundingClientRect();
        if (
          rect.left - ring < clip.left - 1 ||
          rect.right + ring > clip.right + 1 ||
          rect.top - ring < clip.top - 1 ||
          rect.bottom + ring > clip.bottom + 1
        )
          return false;
      }
      ancestor = ancestor.parentElement;
    }
    return (
      rect.left - ring >= 0 &&
      rect.right + ring <= innerWidth &&
      rect.top - ring >= 0 &&
      rect.bottom + ring <= innerHeight
    );
  });
  expect(fits).toBe(true);
}

for (const viewport of viewports) {
  test(`appearance contract and measured surfaces at ${viewport.width}x${viewport.height}`, async ({
    page,
    request,
  }) => {
    test.setTimeout(45000);
    await page.setViewportSize(viewport);
    await mkdir(captures, { recursive: true });
    await mkdir(evidence, { recursive: true });
    expect((await request.post(`${api}/reset`)).ok()).toBeTruthy();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const measurements: unknown[] = [];
    async function capture(state: string, selectors: string[]) {
      await page.screenshot({
        path: path.join(captures, `${state}-${viewport.width}.png`),
      });
      const measured: Record<string, unknown> = {};
      for (const selector of selectors)
        measured[selector] = await page
          .locator(selector)
          .first()
          .evaluate((node) => {
            const s = getComputedStyle(node),
              r = node.getBoundingClientRect();
            return {
              radius: [
                s.borderTopLeftRadius,
                s.borderTopRightRadius,
                s.borderBottomRightRadius,
                s.borderBottomLeftRadius,
              ],
              gap: s.gap,
              padding: s.padding,
              margin: s.margin,
              outlineOffset: s.outlineOffset,
              fontSize: s.fontSize,
              fontWeight: s.fontWeight,
              box: { x: r.x, y: r.y, width: r.width, height: r.height },
            };
          });
      measurements.push({ viewport, state, measured });
    }
    try {
      await page.goto("/");
      await expect(
        page.getByRole("heading", { name: "کتاب", exact: true }),
      ).toBeVisible();
      await layout(page);
      await corners(
        page.locator(".wallet-card,.goal-row,.tabs .button,.goal-symbol"),
      );
      await css(page.locator(".goal-heading").first(), "gap", "12px");
      await css(page.locator(".eyebrow"), "margin-bottom", "4px");
      await css(page.locator(".wallet-card>.money"), "font-size", "24px");
      await css(page.locator(".wallet-card>.money"), "font-weight", "700");
      await css(
        page.locator(".goal-amounts>.money").first(),
        "font-size",
        "17px",
      );
      await corners(page.locator(".progress-track,.progress-track>span"));
      await css(page.locator(".progress-track").first(), "height", "6px");
      const primary = page.getByRole("link", { name: "هدف جدید", exact: true });
      await css(primary, "background-color", "rgb(29, 191, 152)");
      await focusRing(primary);
      await capture("list", [
        ".app-shell",
        ".wallet-card",
        ".wallet-card>.money",
        ".goal-row",
        ".goal-heading",
        ".page-content",
      ]);
      await page.getByRole("tab", { name: "تمام‌شده" }).click();
      await expect(page.locator(".empty-state")).toBeVisible();
      await corners(page.locator(".empty-state,.empty-icon"));
      await capture("empty", [".empty-state", ".empty-icon"]);
      await page.goto("/goals/new");
      await page.getByLabel("نام هدف").fill("اب");
      const amount = page.getByLabel("مبلغ هدف (ریال)");
      await amount.fill("200000000");
      await expect(page.getByRole("alert")).toBeVisible();
      await moneyInput(page, amount);
      await corners(
        page.locator(
          ".input:not([type=radio]):not([type=checkbox]),.button.date-trigger",
        ),
      );
      await css(page.locator(".terms-block input"), "margin-top", "0px");
      await layout(page);
      await capture("form-error", [
        ".field",
        ".amount-input input",
        ".amount-input>span",
        ".action-footer",
      ]);
      const trigger = page.getByRole("button", {
        name: "مهلت رسیدن به هدف",
        exact: true,
      });
      await trigger.click();
      await expect(page.getByRole("grid")).toBeVisible();
      await corners(
        page.locator(
          ".calendar-popover,.calendar-nav,.calendar-caption,.rdp-day_button",
        ),
      );
      await css(page.locator(".calendar-popover"), "padding", "12px");
      await capture("calendar-days", [
        ".calendar-popover",
        ".calendar-caption",
        ".rdp-day_button",
      ]);
      await page
        .getByRole("button", { name: "انتخاب ماه", exact: true })
        .click();
      await corners(page.locator(".calendar-choices .button"));
      await capture("calendar-months", [
        ".calendar-popover",
        ".calendar-choices button",
      ]);
      await page.keyboard.press("Escape");
      await page
        .getByRole("button", { name: "انتخاب سال", exact: true })
        .click();
      await corners(page.locator(".calendar-choices .button"));
      await capture("calendar-years", [
        ".calendar-popover",
        ".calendar-choices button",
      ]);
      await page.keyboard.press("Escape");
      await page
        .getByRole("grid")
        .locator("button:not(:disabled)")
        .first()
        .click();
      await trigger.click();
      await corners(page.locator(".rdp-selected .rdp-day_button"));
      await capture("calendar-selected", [".rdp-selected .rdp-day_button"]);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await page.goto("/goals/trip");
      await expect(
        page.getByRole("heading", { name: "سفر شمال", level: 2 }),
      ).toBeVisible();
      await corners(
        page.locator(".detail-card,.facts-card,.available-row,.status-badge"),
      );
      await capture("detail", [
        ".detail-card",
        ".facts-card",
        ".available-row",
      ]);
      const cancel = page.getByRole("button", { name: "لغو هدف", exact: true });
      await cancel.click();
      const dialog = page.getByRole("dialog");
      await corners(dialog);
      await corners(dialog.locator(".button"));
      await css(page.locator(".dialog-actions"), "gap", "12px");
      await expect(
        dialog.getByRole("button", { name: "انصراف", exact: true }),
      ).toBeFocused();
      await focusRing(
        dialog.getByRole("button", { name: "انصراف", exact: true }),
      );
      await capture("cancel", [
        ".dialog-content",
        ".dialog-actions",
        ".dialog-actions button",
      ]);
      await page.keyboard.press("Escape");
      await expect(cancel).toBeFocused();
      await page.goto("/goals/book");
      await page
        .getByRole("button", { name: "افزودن پول", exact: true })
        .click();
      const deposit = page.getByLabel("مبلغ واریز (ریال)");
      await deposit.fill("50000");
      await moneyInput(page, deposit);
      await corners(page.locator(".deposit-card"));
      await css(page.locator(".section-heading"), "gap", "8px");
      await capture("deposit", [
        ".deposit-card",
        ".amount-input input",
        ".amount-input>span",
      ]);
      let attempt = 0;
      const keys: string[] = [];
      await page.route("**/api/goals/book/deposits", async (route) => {
        keys.push(route.request().headers()["idempotency-key"]);
        if (++attempt === 1) {
          await route.fetch();
          await route.abort();
        } else await route.continue();
      });
      await page
        .getByRole("button", { name: "تأیید واریز", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "بررسی نتیجهٔ واریز قبلی" }),
      ).toBeEnabled();
      await corners(page.locator(".deposit-card"));
      await capture("deposit-unknown", [".deposit-card", ".pending-summary"]);
      await page
        .getByRole("button", { name: "بررسی نتیجهٔ واریز قبلی" })
        .click();
      await expect(page.getByText("واریز با موفقیت ثبت شد.")).toBeVisible();
      expect(keys).toHaveLength(2);
      expect(keys[0]).toBe(keys[1]);
      await corners(page.locator(".toast-success"));
      await expect(
        page.getByRole("button", { name: "افزودن پول", exact: true }),
      ).toBeFocused();
      await capture("deposit-success", [".toast-success", ".available-row"]);
      expect(
        (
          await request.post(`${api}/goals/book/deposits`, {
            data: { amount: 450000 },
            headers: { "Idempotency-Key": "capture-complete" },
          })
        ).ok(),
      ).toBeTruthy();
      await page.reload();
      await expect(page.getByText("این هدف تکمیل شده است")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "افزودن پول" }),
      ).toHaveCount(0);
      await corners(page.locator(".status-badge"));
      await capture("completed", [".status-badge", ".completed-footer"]);
      expect(errors).toEqual([]);
    } finally {
      await writeFile(
        path.join(evidence, `after-metrics-${viewport.width}.json`),
        JSON.stringify(measurements, null, 2) + "\n",
      );
    }
  });
}
