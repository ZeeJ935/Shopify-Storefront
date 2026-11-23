import { expect, test } from "@playwright/test";
import { cardPrices, productLinks } from "./helpers";

test("a brand filter narrows the collection", async ({ page }) => {
  await page.goto("/collections/all");
  await expect(productLinks(page).first()).toBeVisible();

  const brand = page.locator("label", { has: page.locator("input[type=checkbox]") }).filter({ hasText: /^\s*(Nike|Adidas)/ }).first();
  await brand.click();
  await expect(page).toHaveURL(/brand=/i);
  await expect(productLinks(page).first()).toBeVisible();
  // Every card now shows that brand.
  const chosen = (await brand.innerText()).trim().split(/\s+/)[0].toUpperCase();
  const brands = await page.locator("main a[href^='/products/'] p").allInnerTexts();
  const labels = brands.filter((t) => t.includes("·"));
  expect(labels.length).toBeGreaterThan(0);
  for (const label of labels) expect(label.toUpperCase()).toContain(chosen);
});

test("sorting by price puts the cheapest first", async ({ page }) => {
  await page.goto("/collections/all?available=1");
  await page.locator("main select").first().selectOption({ label: "Price: Low to High" });
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect(productLinks(page).first()).toBeVisible();
  const prices = await cardPrices(page);
  expect(prices.length).toBeGreaterThan(3);
  for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThanOrEqual(prices[i - 1]);
});

test("scrolling loads more products", async ({ page }) => {
  await page.goto("/collections/all");
  await expect(productLinks(page).first()).toBeVisible();
  const before = await productLinks(page).count();
  for (let i = 0; i < 8 && (await productLinks(page).count()) === before; i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(700);
  }
  expect(await productLinks(page).count()).toBeGreaterThan(before);
});
