import { expect, test } from "@playwright/test";
import { openFirstInStockProduct } from "./helpers";

test("a guest's heart goes to login, remembering the product (never reaches Shopify)", async ({ page }) => {
  const productPath = await openFirstInStockProduct(page);

  // Stop at our own login page: don't follow on to Shopify's hosted login.
  await page.route("**/account/authorize**", (route) => route.abort());

  await page.locator("main").getByRole("button", { name: "Sign in to save favourites" }).first().click();
  await expect(page).toHaveURL(/\/account\/login\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("returnTo")).toBe(productPath);
  expect(url.searchParams.get("add")).toMatch(/^gid:\/\/shopify\/Product\/\d+$/);
});
