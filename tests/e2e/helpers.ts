import { type APIRequestContext, expect, type Page } from "@playwright/test";

const MAILPIT = "http://127.0.0.1:54324";

export async function signUp(
  page: Page,
  request: APIRequestContext,
): Promise<{ email: string }> {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.test`;
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.locator("form button[type=submit]").first().click();
  await expect(page.getByText("Check your email")).toBeVisible();

  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const res = await request.get(
          `${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`,
        );
        const list = await res.json();
        const id = list.messages?.[0]?.ID;
        if (!id) return undefined;
        const msg = await (
          await request.get(`${MAILPIT}/api/v1/message/${id}`)
        ).json();
        link = `${msg.Text}\n${msg.HTML}`
          .match(/http:\/\/127\.0\.0\.1:54321\/auth\/v1\/verify[^\s"'<>]*/)?.[0]
          ?.replaceAll("&amp;", "&");
        return link;
      },
      { timeout: 15_000 },
    )
    .toBeTruthy();

  await page.goto(link as string);
  await expect(page).toHaveURL(/\/dashboard$/);
  return { email };
}
