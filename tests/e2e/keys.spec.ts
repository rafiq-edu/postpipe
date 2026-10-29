import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("create and revoke an API key", async ({ page, request }) => {
  await signUp(page, request);
  await page.goto("/dashboard/keys?mode=test");
  await page.getByLabel("Name").fill("ci");
  await page.getByLabel("Mode").selectOption("test");
  await page.getByRole("button", { name: "Create key" }).click();
  await expect(page.locator("[data-testid=new-key]")).toHaveText(
    /^pp_test_[A-Za-z0-9]{32}$/,
  );
  await expect(page.locator("table")).toContainText("ci");
  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.locator("table")).toContainText("Revoked");
});
