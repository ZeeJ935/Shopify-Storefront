import { expect, type Page } from "@playwright/test";

/** Product links inside the main content (cards on listing pages). */
export const productLinks = (page: Page) => page.locator("main a[href^='/products/']");

/** The current price on each product card, as numbers (in-stock cards only). */
export async function cardPrices(page: Page): Promise<number[]> {
  // The current price is the first "USD 50.00"-style value on each card (titles also use bold text).
  const cards = await page.locator("main a[href^='/products/']").allInnerTexts();
  return cards
    .map((text) => /\b[A-Z]{3}\s?([\d,]+(?:\.\d+)?)/.exec(text)?.[1])
    .filter((m): m is string => Boolean(m))
    .map((m) => Number(m.replace(/,/g, "")));
}

/** Opens the first in-stock product from a listing and returns its path. */
export async function openFirstInStockProduct(page: Page, listing = "/collections/all?available=1"): Promise<string> {
  await page.goto(listing);
  const first = productLinks(page).first();
  await expect(first).toBeVisible();
  const href = (await first.getAttribute("href")) ?? "";
  await page.goto(href);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  return href;
}

/** Picks the first available size/variant when the product has a variant picker. */
export async function pickFirstAvailableVariant(page: Page) {
  const picker = page.getByRole("button", { name: "Select variant" });
  if ((await picker.count()) === 0) return;
  await picker.click();
  await page.getByRole("option").and(page.locator(":not([aria-disabled='true'])")).first().click();
}
