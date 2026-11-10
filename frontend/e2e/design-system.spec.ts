import { test, expect } from "@playwright/test";
const api = `${process.env.E2E_API_URL || "http://127.0.0.1:4000"}/api`;

test("shared controls keep deposits inline and dismiss cancellation safely", async ({
  page,
  request,
}) => {
  expect((await request.post(`${api}/reset`)).ok()).toBeTruthy();
  await page.goto("/goals/book");
  const add = page.getByRole("button", { name: "افزودن پول", exact: true });
  await add.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const amount = page.getByLabel("مبلغ واریز (ریال)");
  await expect(amount).toBeFocused();
  await amount.fill("٥٠٠٠٠");
  await expect(amount).toHaveValue("۵۰٬۰۰۰");
  await page
    .getByRole("button", { name: "بستن فرم واریز", exact: true })
    .click();
  await expect(add).toBeFocused();
  await add.click();
  await expect(amount).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "تأیید واریز", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "بستن فرم واریز", exact: true })
    .click();
  const cancel = page.getByRole("button", { name: "لغو هدف", exact: true });
  await cancel.click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("button", { name: "انصراف", exact: true }),
  ).toBeFocused();
  await dialog
    .getByRole("button", { name: "بستن تأیید لغو", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(cancel).toBeFocused();
  expect(
    (await (await request.get(`${api}/wallet`)).json()).availableAmount,
  ).toBe(25000000);
  expect((await request.get(`${api}/goals/book`)).ok()).toBeTruthy();
});
