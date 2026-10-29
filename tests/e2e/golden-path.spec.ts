// Golden path: sign up -> live key -> connect Bluesky -> upload JPEG -> post
// 60 s ahead -> wait for success with a URL -> check the webhook.
//
// Deviation from the plan: Bluesky is connected with the app-password form
// ("Use an app password instead"), not OAuth. OAuth would need scripting the
// bsky.social login page; OAuth is covered by unit tests.
//
// Runs only when BLUESKY_TEST_HANDLE and BLUESKY_TEST_APP_PASSWORD are set.
// The webhook test also needs E2E_WEBHOOK_PUBLIC_URL (https tunnel to this
// machine) and E2E_WEBHOOK_PORT. The url guard rejects localhost, so a tunnel
// is required. The post stays on Bluesky: there is no delete path.
// Never log or screenshot the credentials. Do not enable traces for this spec.
import { type ChildProcess, spawn } from "node:child_process";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { verifyWebhook } from "../../lib/webhooks/sign";
import { signUp } from "./helpers";
import { startReceiver } from "./webhook-receiver";

const handle = process.env.BLUESKY_TEST_HANDLE;
const appPassword = process.env.BLUESKY_TEST_APP_PASSWORD;
const publicUrl = process.env.E2E_WEBHOOK_PUBLIC_URL;
const port = Number(process.env.E2E_WEBHOOK_PORT);
const webhookEnabled = Boolean(publicUrl && port);

test.describe.configure({ mode: "serial" });
test.skip(
  !handle || !appPassword,
  "BLUESKY_TEST_HANDLE and BLUESKY_TEST_APP_PASSWORD are not set",
);

let worker: ChildProcess | undefined;
let receiver: Awaited<ReturnType<typeof startReceiver>> | undefined;
let postId = "";
let endpointSecret = "";

test.beforeAll(async () => {
  worker = spawn("pnpm", ["worker"], { env: process.env, stdio: "ignore" });
  if (webhookEnabled) receiver = await startReceiver(port);
});

test.afterAll(async () => {
  worker?.kill("SIGTERM");
  await receiver?.close();
});

test("publish to Bluesky and reach success with a URL", async ({
  page,
  request,
  baseURL,
}) => {
  test.setTimeout(6 * 60_000);
  await signUp(page, request);
  await page.goto("/dashboard/keys");
  await page.getByLabel("Name").fill("golden");
  await page.getByLabel("Mode").selectOption("live");
  await page.getByRole("button", { name: "Create key" }).click();
  const key = (await page.locator("[data-testid=new-key]").textContent()) ?? "";
  expect(key).toMatch(/^pp_live_/);
  const auth = { authorization: `Bearer ${key}` };

  const authUrl = await request.post("/api/v1/social-accounts/auth-url", {
    headers: auth,
    data: {
      platform: "bluesky",
      external_id: "e2e-golden",
      redirect_url: `${baseURL}/privacy`,
    },
  });
  expect(authUrl.ok()).toBe(true);
  await page.goto((await authUrl.json()).url);
  await page.getByText("Use an app password instead").click();
  const form = page.locator("details");
  await form.getByLabel("Your handle").fill(handle as string);
  await form.getByLabel("App password").fill(appPassword as string);
  await form.getByRole("button", { name: "Connect account" }).click();
  await expect(page).toHaveURL(/\/privacy\?status=success&account_id=/);
  const accountId = new URL(page.url()).searchParams.get("account_id") ?? "";

  const jpeg = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#3366cc" },
  })
    .jpeg()
    .toBuffer();
  const up = await request.post("/api/v1/media/create-upload-url", {
    headers: auth,
    data: { mime: "image/jpeg", bytes: jpeg.length },
  });
  expect(up.ok()).toBe(true);
  const media = await up.json();
  const put = await request.put(media.upload_url, {
    headers: { "content-type": "image/jpeg" },
    data: jpeg,
  });
  expect(put.ok()).toBe(true);

  if (webhookEnabled) {
    const ep = await request.post("/api/v1/webhooks", {
      headers: auth,
      data: {
        url: publicUrl,
        events: ["social.post.result.created"],
      },
    });
    expect(ep.status()).toBe(201);
    endpointSecret = (await ep.json()).secret;
  }

  const post = await request.post("/api/v1/social-posts", {
    headers: auth,
    data: {
      caption: `PostPipe e2e automated test ${new Date().toISOString()}`,
      media: [{ url: media.media_url, alt_text: "blue square" }],
      social_accounts: [accountId],
      scheduled_at: new Date(Date.now() + 60_000).toISOString(),
    },
  });
  expect(post.status()).toBe(201);
  postId = (await post.json()).id;

  const results = async () =>
    (
      await (
        await request.get(`/api/v1/social-post-results?post_id=${postId}`, {
          headers: auth,
        })
      ).json()
    ).data as { status: string; platform_post_url: string | null }[];
  await expect
    .poll(async () => (await results())[0]?.status, {
      timeout: 4 * 60_000,
      intervals: [5_000],
    })
    .toMatch(/^(success|error|cancelled)$/);
  const [result] = await results();
  expect(result.status).toBe("success");
  expect(result.platform_post_url).toBeTruthy();
});

test("webhook receives a signed social.post.result.created", async () => {
  test.skip(
    !webhookEnabled,
    "E2E_WEBHOOK_PUBLIC_URL and E2E_WEBHOOK_PORT are not set",
  );
  const hit = async () =>
    receiver?.deliveries.find((d) => {
      try {
        return JSON.parse(d.body).data?.post_id === postId;
      } catch {
        return false;
      }
    });
  await expect.poll(hit, { timeout: 60_000 }).toBeTruthy();
  const d = (await hit()) as { body: string; signature: string };
  expect(JSON.parse(d.body)).toMatchObject({
    event: "social.post.result.created",
  });
  expect(verifyWebhook(d.body, d.signature, endpointSecret)).toBe(true);
});
