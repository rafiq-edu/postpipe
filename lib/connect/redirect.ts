/** Append query params to a customer redirect URL (used for success, error and cancel). */
export const redirectUrlWith = (
  redirectUrl: string,
  q: Record<string, string>,
): string => {
  const url = new URL(redirectUrl);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v);
  return url.toString();
};

export const cancelUrl = (redirectUrl: string): string =>
  redirectUrlWith(redirectUrl, { status: "error", reason: "cancelled" });
