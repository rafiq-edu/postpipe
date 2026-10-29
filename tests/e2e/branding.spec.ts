import { expect, test } from "@playwright/test";
import { testDb } from "../db";
import { signUp } from "./helpers";

// 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("branded connect page and expired link", async ({
  page,
  request,
  baseURL,
}) => {
  await signUp(page, request);
  await page.goto("/dashboard/settings");
  await page.getByLabel("Display name").fill("Acme Brand");
  await page
    .getByLabel(/^Logo/)
    .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: PNG });
  await page.getByRole("button", { name: "Save branding" }).click();
  await expect(page.getByRole("status")).toHaveText("Saved.");
  await expect(page.getByTestId("logo-preview")).toBeVisible();

  await page.goto("/dashboard/keys");
  await page.getByLabel("Name").fill("brand");
  await page.getByLabel("Mode").selectOption("test");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator("[data-testid=new-key]").textContent()) ?? "";
  const res = await request.post("/api/v1/social-accounts/auth-url", {
    headers: { authorization: `Bearer ${key}` },
    data: {
      platform: "mock",
      external_id: "brand",
      redirect_url: `${baseURL}/privacy`,
    },
  });
  expect(res.ok()).toBe(true);
  const { url } = await res.json();
  await page.goto(url);
  await expect(page.getByTestId("brand-name")).toHaveText("Acme Brand");
  await expect(page.getByTestId("brand-logo")).toBeVisible();
  await expect(page.getByText("Powered by PostPipe")).toBeVisible();

  const db = await testDb();
  const { error } = await db
    .from("connect_sessions")
    .update({ expires_at: new Date(Date.now() - 1000).toISOString() })
    .eq("external_id", "brand");
  expect(error).toBeNull();
  await page.goto(url);
  await expect(page.getByRole("heading")).toContainText("Link expired");
  await expect(page.getByTestId("connect-retry")).toHaveAttribute(
    "href",
    `${baseURL}/privacy?status=error&reason=expired`,
  );

  await page.goto("/connect/not-a-real-token");
  await expect(page.getByRole("heading")).toContainText("Link not found");
  await expect(page.getByText("Powered by PostPipe")).toBeVisible();
});
