import { expect, test } from "@playwright/test";

for (const path of ["/", "/pricing"]) {
  test(`${path} shows three plans`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByTestId("plan-free")).toContainText("$0");
    await expect(page.getByTestId("plan-builder")).toContainText("$12");
    await expect(page.getByTestId("plan-scale")).toContainText("$59");
  });
}

test("nav links work", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/");
  await page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Docs" })
    .click();
  await expect(page).toHaveURL(/\/docs/);
});
