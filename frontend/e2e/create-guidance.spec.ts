import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const captures =
  process.env.E2E_SCREENSHOTS || "../artifacts/screenshots/create-guidance";

// This form-only regression never resets or writes API data.
for (const viewport of [
  { width: 320, height: 640 },
  { width: 800, height: 420 },
]) {
  test(`disabled creation explains missing name and guides focus at ${viewport.width}`, async ({
    page,
  }) => {
    await page.route("**/api/**", (route) => route.abort());
    await page.setViewportSize(viewport);
    await page.goto("/goals/new");
    const submit = page.getByRole("button", { name: "ساخت هدف", exact: true });
    await expect(submit).toBeInViewport();
    await page.getByLabel("مبلغ هدف (ریال)").fill("1000000");
    await page
      .getByRole("button", { name: "مهلت رسیدن به هدف", exact: true })
      .click();
    await page
      .getByRole("grid")
      .locator("button:not(:disabled)")
      .first()
      .click();
    await page.getByRole("checkbox").check();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAccessibleDescription(
      "برای ساخت هدف، این موارد را تکمیل یا اصلاح کن: نام هدف.",
    );
    const shortcut = page.getByRole("button", { name: "رفتن به نام هدف" });
    await expect(shortcut).toBeInViewport();
    await mkdir(captures, {
      recursive: true,
    });
    await page.screenshot({
      path: `${captures}/missing-name-${viewport.width}.png`,
    });
    await shortcut.click();
    const name = page.getByLabel("نام هدف");
    await expect(name).toBeFocused();
    await expect(name).toBeInViewport();
    await name.fill("دوچرخه");
    await expect(submit).toBeEnabled();
    await expect(shortcut).toHaveCount(0);
    expect(
      await page
        .locator(".page-content")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });
}
