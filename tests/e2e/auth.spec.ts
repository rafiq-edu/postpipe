import { expect, test } from "@playwright/test";
import { signUp } from "./helpers";

test("sign up with a magic link and land on the dashboard", async ({
  page,
  request,
}) => {
  const { email } = await signUp(page, request);
  await expect(page.locator("h1")).toHaveText(email.split("@")[0]);
});
