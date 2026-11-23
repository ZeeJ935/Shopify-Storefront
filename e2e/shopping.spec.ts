import { expect, test } from "@playwright/test";
import { pickFirstAvailableVariant, productLinks } from "./helpers";

test("home → collection → product → add to cart → cart page", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Into a collection from the main navigation.
  await page.getByRole("navigation").getByRole("link", { name: /^men$/i }).first().click();
  await expect(page).toHaveURL(/\/collections\/men/);
  await expect(productLinks(page).first()).toBeVisible();

  // An in-stock product (sold-out ones have no Add to cart).
  await page.goto("/collections/men?available=1");
  const productHref = await productLinks(page).first().getAttribute("href");
  await productLinks(page).first().click();
  await expect(page).toHaveURL(productHref ?? /\/products\//);
  const title = (await page.getByRole("heading", { level: 1 }).innerText()).trim();

  await pickFirstAvailableVariant(page);
  await page.getByRole("button", { name: "Add to cart" }).click();

  // The drawer opens with the line and a subtotal.
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Subtotal")).toBeVisible();
  await expect(drawer.getByText(title, { exact: false }).first()).toBeVisible();

  // Cart page lists it. We never click checkout.
  await drawer.getByRole("link", { name: "View bag" }).click();
  await expect(page).toHaveURL(/\/cart$/);
  await expect(page.getByRole("main").getByText(title, { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("main").getByText("Subtotal")).toBeVisible();
  await expect(page.getByRole("button", { name: /Proceed to Checkout/i })).toBeVisible();
});
