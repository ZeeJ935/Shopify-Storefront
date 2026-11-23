import { expect, test } from "@playwright/test";

test("search suggests products while typing, Enter opens results", async ({ page, request }) => {
  // A real word from a real product title, so the test doesn't depend on specific products.
  const catalog = await (await request.get("/api/catalog?sort=price-asc")).json();
  const word = String(catalog.products[0].title).split(/\s+/).find((w: string) => w.length >= 4) ?? "shoe";

  await page.goto("/");
  await page.getByRole("button", { name: "Search" }).click();
  const input = page.getByPlaceholder("Search products, collections…");
  await input.fill(word);
  await expect(page.getByRole("dialog").locator("a[href^='/products/']").first()).toBeVisible();

  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp(`/search\\?q=${encodeURIComponent(word)}`, "i"));
  await expect(page.locator("main a[href^='/products/']").first()).toBeVisible();
});
