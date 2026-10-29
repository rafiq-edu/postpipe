import { Logo } from "@/components/brand/logo";
import { parseBranding } from "@/lib/connect/branding";
import { callbackUrl, pkceChallenge } from "@/lib/connect/oauth";
import { cancelUrl, redirectUrlWith } from "@/lib/connect/redirect";
import { decryptToken } from "@/lib/crypto/tokens";
import { createServiceClient } from "@/lib/db/client";
import {
  findConnectSessionByToken,
  sessionIsOpen,
} from "@/lib/db/queries/connect-sessions";
import { loadSecretOverrides } from "@/lib/db/queries/platform-apps";
import { presignGet } from "@/lib/media/s3";
import {
  keysAvailable,
  notAvailableMessage,
} from "@/lib/platforms/availability";
import { PLATFORM_LABELS } from "@/lib/platforms/labels";
import { adapterFor } from "@/lib/platforms/registry";
import type { Json, Platform } from "@/lib/platforms/types";
import { withSecretOverrides } from "@/lib/secrets";
import { connectBlueskyAppPassword, startBlueskyOAuth } from "./actions";

export const dynamic = "force-dynamic";

const primaryBtn =
  "inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function Frame({
  header,
  children,
}: {
  header?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-dvh flex-col items-center bg-canvas p-4">
      <div className="mt-[6vh] w-full max-w-sm rounded-lg border border-border bg-panel p-6">
        {header}
        <div className="grid gap-4">{children}</div>
      </div>
      <p className="mt-auto flex items-center gap-1.5 pt-6 text-xs text-muted-foreground">
        <Logo markOnly className="text-xs" /> Powered by PostPipe
      </p>
    </main>
  );
}

const Title = ({ children }: { children: React.ReactNode }) => (
  <h1 className="text-3xl font-semibold leading-tight tracking-tight">
    {children}
  </h1>
);

function CancelLink({ redirectUrl }: { redirectUrl?: string | null }) {
  if (!redirectUrl) return null;
  return (
    <a
      href={cancelUrl(redirectUrl)}
      data-testid="connect-cancel"
      className="text-center text-sm underline underline-offset-4"
    >
      Cancel
    </a>
  );
}

function ErrorPage({
  title,
  message,
  redirectUrl,
  reason,
}: {
  title: string;
  message: string;
  redirectUrl?: string | null;
  reason: "expired" | "used" | "invalid" | "platform_not_available";
}) {
  const retry = redirectUrl
    ? redirectUrlWith(redirectUrl, { status: "error", reason })
    : null;
  return (
    <Frame>
      <Title>{title}</Title>
      <p>{message}</p>
      {retry ? (
        <a href={retry} className={primaryBtn} data-testid="connect-retry">
          Try again
        </a>
      ) : (
        <p className="text-muted-foreground">
          Go back to the app that sent you here and start again.
        </p>
      )}
    </Frame>
  );
}

export default async function ConnectPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ handle?: string; error?: string }>;
}) {
  const { token } = await params;
  const { handle, error: loginError } = await searchParams;
  const session = await findConnectSessionByToken(token);
  if (!session)
    return (
      <ErrorPage
        title="Link not found"
        message="This connect link is not valid."
        reason="invalid"
      />
    );
  if (!sessionIsOpen(session)) {
    const used = session.used_at !== null;
    return (
      <ErrorPage
        title={used ? "Link already used" : "Link expired"}
        message={
          used
            ? "This connect link was already used."
            : "This connect link has expired."
        }
        redirectUrl={session.redirect_url}
        reason={used ? "used" : "expired"}
      />
    );
  }

  const db = await createServiceClient();
  const { data: org, error } = await db
    .from("organizations")
    .select("name, branding")
    .eq("id", session.org_id)
    .single();
  if (error) throw error;
  const branding = parseBranding(org.branding);
  const displayName = branding.name ?? org.name;
  const logoUrl = branding.logo_key
    ? await presignGet(branding.logo_key, 3600)
    : null;
  const header = (
    <header className="mb-6 flex items-center gap-3">
      {logoUrl ? (
        // biome-ignore lint/performance/noImgElement: presigned S3 URL, next/image not configured for it
        <img
          src={logoUrl}
          alt={displayName}
          data-testid="brand-logo"
          className="max-h-10 w-auto"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-sm font-semibold"
        >
          {displayName.trim().charAt(0).toUpperCase()}
        </span>
      )}
      <p className="min-w-0 break-words font-medium" data-testid="brand-name">
        {displayName}
      </p>
    </header>
  );
  const adapter = adapterFor(
    session.mode as "live" | "test",
    session.platform as Platform,
  );
  const label =
    PLATFORM_LABELS[session.platform as keyof typeof PLATFORM_LABELS];

  const testBanner = session.mode === "test" && (
    <p className="rounded-md bg-brand-soft p-3 text-sm text-brand-foreground">
      Test mode: this connects a mock account.
    </p>
  );

  if (session.platform === "bluesky" && session.mode === "live") {
    const input =
      "h-10 rounded-md border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring";
    const appPasswordOnly =
      (session.platform_data as { auth?: unknown }).auth === "app_password";
    const appPasswordForm = (
      <form
        action={connectBlueskyAppPassword.bind(null, token)}
        className="grid gap-4"
      >
        <div className="grid gap-2">
          <label htmlFor="handle" className="text-sm font-medium">
            Your handle
          </label>
          <input
            id="handle"
            name="handle"
            required
            autoComplete="username"
            placeholder="name.bsky.social"
            className={input}
          />
        </div>
        <div className="grid gap-2">
          <label htmlFor="app_password" className="text-sm font-medium">
            App password
          </label>
          <input
            id="app_password"
            name="app_password"
            type="password"
            required
            autoComplete="off"
            className={input}
          />
          <p className="text-xs text-muted-foreground">
            Use an app password, not your main password.{" "}
            <a
              href="https://bsky.app/settings/app-passwords"
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-4"
            >
              How to create an app password
            </a>
          </p>
        </div>
        <button type="submit" className={primaryBtn}>
          Connect account
        </button>
      </form>
    );
    return (
      <Frame header={header}>
        <Title>Connect your {label} account</Title>
        {loginError && (
          <p role="alert" className="text-sm text-destructive">
            {loginError === "login"
              ? "Handle or app password is wrong."
              : loginError === "locked"
                ? "Too many wrong tries. This link is closed. Ask for a new one."
                : loginError === "handle"
                  ? "We could not find that Bluesky handle. Check it and try again."
                  : "We could not reach Bluesky. Try again."}
          </p>
        )}
        {appPasswordOnly ? (
          appPasswordForm
        ) : (
          <>
            <form
              action={startBlueskyOAuth.bind(null, token)}
              className="grid gap-4"
            >
              <div className="grid gap-2">
                <label htmlFor="oauth_handle" className="text-sm font-medium">
                  Bluesky handle
                </label>
                <input
                  id="oauth_handle"
                  name="handle"
                  required
                  autoComplete="username"
                  placeholder="name.bsky.social"
                  className={input}
                />
              </div>
              <button type="submit" className={primaryBtn}>
                Continue with Bluesky
              </button>
            </form>
            <details className="grid gap-4 text-sm">
              <summary className="cursor-pointer underline underline-offset-4">
                Use an app password instead
              </summary>
              <div className="mt-4">{appPasswordForm}</div>
            </details>
          </>
        )}
        <CancelLink redirectUrl={session.redirect_url} />
      </Frame>
    );
  }

  if (adapter.handleInput && !handle)
    return (
      <Frame header={header}>
        <Title>Connect your {label} account</Title>
        {testBanner}
        <form method="get" className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="handle" className="text-sm font-medium">
              Your handle
            </label>
            <input
              id="handle"
              name="handle"
              required
              className="h-10 rounded-md border border-input bg-background px-3 focus-visible:outline-2 focus-visible:outline-ring"
            />
          </div>
          <button type="submit" className={primaryBtn}>
            Connect account
          </button>
        </form>
        <CancelLink redirectUrl={session.redirect_url} />
      </Frame>
    );

  let url: string;
  try {
    const verifier = await decryptToken(session.pkce_verifier_enc ?? "");
    const overrides = await loadSecretOverrides(
      session.org_id,
      session.platform,
    );
    if (session.mode === "live" && !keysAvailable(session.platform, overrides))
      return (
        <ErrorPage
          title="Not available yet"
          message={notAvailableMessage(label)}
          redirectUrl={session.redirect_url}
          reason="platform_not_available"
        />
      );
    ({ url } = await withSecretOverrides(overrides, () =>
      adapter.getAuthUrl({
        state: session.id,
        redirectUri: callbackUrl(adapter.platform),
        codeChallenge: pkceChallenge(verifier),
        platformData: {
          ...(session.platform_data as Record<string, Json>),
          ...(handle ? { handle } : {}),
        },
      }),
    ));
  } catch {
    return (
      <ErrorPage
        title="Something went wrong"
        message={`We could not start the ${label} connection.`}
        redirectUrl={session.redirect_url}
        reason="invalid"
      />
    );
  }
  return (
    <Frame header={header}>
      <Title>Connect your {label} account</Title>
      {testBanner}
      <a href={url} data-testid="connect-continue" className={primaryBtn}>
        Connect account
      </a>
      <CancelLink redirectUrl={session.redirect_url} />
    </Frame>
  );
}
