import { expect, test } from "@playwright/test";
import { createServiceClient } from "../../lib/db/client";
import { signUp } from "./helpers";

try {
  process.loadEnvFile(".env.local");
} catch {
  // CI sets the env directly
}

const RAW = {
  error: { type: "OAuthException", code: 190, trace: "fbtrace-e2e" },
};

test("every dashboard screen renders seeded data", async ({
  page,
  request,
}) => {
  const { email } = await signUp(page, request);
  await page.goto("/dashboard/settings");
  const orgId =
    (await page
      .getByText("Organization ID")
      .locator("xpath=following-sibling::dd")
      .textContent()) ?? "";
  expect(orgId).toMatch(/^[0-9a-f-]{36}$/);

  const db = await createServiceClient();
  const base = { org_id: orgId, mode: "live" };
  const must = <T>(r: { data: T; error: unknown }): NonNullable<T> => {
    if (r.error || !r.data) throw r.error ?? new Error("seed failed");
    return r.data;
  };
  const account = must(
    await db
      .from("social_accounts")
      .insert({
        ...base,
        platform: "bluesky",
        external_id: "e2e-acct",
        platform_user_id: "did:e2e",
        display_name: "E2E Account",
        status: "connected",
        token_expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      })
      .select("id")
      .single(),
  );
  const post = must(
    await db
      .from("social_posts")
      .insert({ ...base, caption: "e2e caption", status: "failed" })
      .select("id")
      .single(),
  );
  must(
    await db
      .from("social_post_targets")
      .insert({
        ...base,
        post_id: post.id,
        social_account_id: account.id,
        platform: "bluesky",
        status: "error",
        error_code: "platform_rejected",
        error_message: "e2e rejected",
        raw_error: RAW,
      })
      .select("id")
      .single(),
  );
  const ep = must(
    await db
      .from("webhook_endpoints")
      .insert({
        ...base,
        url: "https://hooks.example.com/e2e",
        secret_enc: "x",
        events: ["social.post.created"],
      })
      .select("id")
      .single(),
  );
  must(
    await db
      .from("webhook_deliveries")
      .insert({
        ...base,
        endpoint_id: ep.id,
        event: "social.post.created",
        payload: { data: { account_id: account.id } },
        status: "dead",
        attempt: 5,
        response_code: 500,
      })
      .select("id")
      .single(),
  );

  await page.goto("/dashboard");
  await expect(page.getByText("Posts this month")).toBeVisible();
  await expect(page.getByText("Connected accounts")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Platform approvals" }),
  ).toBeVisible();
  await expect(
    page
      .locator("#approvals ~ ul li, section[aria-labelledby=approvals] li")
      .first(),
  ).toBeVisible();

  await page.goto("/dashboard/posts");
  await expect(page.getByText("e2e caption")).toBeVisible();
  await page.getByText("e2e caption").click();
  await expect(page.getByText("e2e rejected").first()).toBeVisible();
  await expect(page.getByText("fbtrace-e2e")).toHaveCount(0);

  await page.goto("/dashboard/accounts");
  await expect(page.getByRole("cell", { name: "E2E Account" })).toBeVisible();
  await expect(page.getByText("expiring")).toBeVisible();
  await expect(page.getByRole("button", { name: "Disconnect" })).toBeVisible();

  await page.goto("/dashboard/keys");
  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();

  await page.goto("/dashboard/webhooks");
  await expect(page.getByText("https://hooks.example.com/e2e")).toBeVisible();
  const rows = page.getByTestId("delivery-row");
  await expect(rows).toHaveCount(1);
  await page.getByRole("button", { name: "Replay" }).click();
  await expect(rows).toHaveCount(2);

  await page.goto("/dashboard/billing");
  await expect(page.getByText("Posts this month")).toBeVisible();

  await page.goto("/dashboard/settings");
  await expect(page.getByRole("main").getByText(email)).toBeVisible();

  // test mode hides the live rows
  await page.goto("/dashboard/accounts?mode=test");
  await expect(page.getByText("No connected accounts.")).toBeVisible();
});
