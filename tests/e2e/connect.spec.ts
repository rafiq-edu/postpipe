import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("hosted connect flow with the mock adapter", async ({
  page,
  request,
  baseURL,
}) => {
  await signUp(page, request);
  await page.goto("/dashboard/keys");
  await page.getByLabel("Name").fill("connect");
  await page.getByLabel("Mode").selectOption("test");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator("[data-testid=new-key]").textContent()) ?? "";

  const res = await request.post("/api/v1/social-accounts/auth-url", {
    headers: { authorization: `Bearer ${key}` },
    data: {
      platform: "mock",
      external_id: "e2e",
      redirect_url: `${baseURL}/privacy`,
    },
  });
  expect(res.ok()).toBe(true);
  await page.goto((await res.json()).url);
  await expect(page.getByRole("heading")).toContainText("Mock");
  await page.locator("[data-testid=connect-continue]").click();
  await page.getByLabel("Mock Page Two").check();
  await page.locator("[data-testid=connect-pick]").click();
  await expect(page).toHaveURL(
    /\/privacy\?status=success&account_id=[0-9a-f-]{36}$/,
  );
});
