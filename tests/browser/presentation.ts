import { expect, type Page } from "@playwright/test";

export async function setPresentation(page: Page, field: "placement", value: string) {
  const button = page.getByRole("dialog").locator(`[data-${field}]`);
  for (let i = 0; i < 3; i++) {
    if (await button.getAttribute(`data-${field}`) === value) return;
    await button.click();
  }
  await expect(button).toHaveAttribute(`data-${field}`, value);
}

export async function openPlaced(page: Page, id: string) {
  const selected = page.locator('[data-symbol-asset][aria-pressed="true"]');
  if (await selected.count()) await selected.click();
  await page.locator(`[data-symbol-site="${id}"]`).click();
}
