# Keys registry

Every secret, token and external credential the project will need, with where it comes from and whether we have it. Updated 2026-10-27. Owner rule: keys are collected and recorded here as they arrive, and building never waits for one.

## Rules

- Real values live only in `.env.local` (gitignored; Claude is blocked from reading `.env*` by a hook) and, in Phase D, in AWS Secrets Manager under `postpipe/<stage>/<KEY>`. Never in code, config, docs or chat.
- Code reads every key through `getSecret(name)` in `lib/secrets.ts`. A missing key throws `MissingSecret: <name>` with a pointer to this file.
- `.env.example` lists the same names with empty values. Adding a key means: add a row here, add the name to `.env.example`, use `getSecret` in code.
- Status words: HAVE (value is in `.env.local`), PENDING (owner must obtain it), GENERATE (we create it with a command), LOCAL (dummy value for Docker only, not a secret), LATER (not needed before Phase D or a later decision).
- Until a platform key arrives, that platform's adapter is built and tested against recorded fixtures and the mock platform. Test mode (`pp_test_` keys) never needs a real platform key.

## Application

| Key | Used by | Where it comes from | Status |
|---|---|---|---|
| `TOKEN_KEY_V1` | token encryption (Task 11) | `openssl rand -base64 32`, run by the owner once | GENERATE |
| `CURRENT_TOKEN_KEY_VERSION` | token encryption | set to `1` | LOCAL |
| `SECRETS_SOURCE` | `lib/secrets.ts` | `env` locally, `aws` in Phase D | LOCAL |
| `STAGE` | `lib/secrets.ts` secret path `postpipe/<STAGE>/<KEY>` | `dev` locally; `dev` or `production` on AWS | LOCAL |
| `NEXT_PUBLIC_APP_URL` | links, OAuth redirect URIs | `http://localhost:3000` locally, `https://postpipe.com` later | LOCAL |
| `NEXT_PUBLIC_CONNECT_URL` | hosted connect page links (`/connect/<token>`) | unset locally, falls back to `NEXT_PUBLIC_APP_URL`; `https://connect.postpipe.com` later | LOCAL |
| `WORKER_CONCURRENCY` | worker | default `5` | LOCAL |
| `LOG_LEVEL` (not a secret; `debug` or unset) | `lib/log/logger.ts`; `debug` turns on debug logs, anything else hides them | set by the operator | LOCAL |
| `NEXT_PUBLIC_AUTH_GOOGLE` | login page; shows "Continue with Google" only when `true` | set to `true` after the Supabase Google provider keys exist | LOCAL (unset) |

## Supabase

| Key | Used by | Where it comes from | Status |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | app and worker | `supabase start` output locally; project settings later | LOCAL / PENDING (cloud project) |
| `SUPABASE_INTERNAL_URL` | server code inside Docker | `http://host.docker.internal:54321` locally; unset on AWS | LOCAL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | dashboard auth (browser) | same | LOCAL / PENDING |
| `SUPABASE_SERVICE_ROLE_KEY` | API routes and worker (server only) | same | LOCAL / PENDING |
| `DATABASE_URL` | migrations, worker SQL | `supabase start` output; connection pooler string later | LOCAL / PENDING |
| `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET` | Supabase Auth, Google login on the dashboard (`supabase/config.toml` `[auth.external.google]`) | Google Cloud OAuth client (web) with the Supabase callback URL; can be the same client as the YouTube keys below | LATER |

## AWS and media

| Key | Used by | Where it comes from | Status |
|---|---|---|---|
| `AWS_ENDPOINT_URL` | S3 client | `http://localstack:4566` locally; unset on AWS | LOCAL |
| `AWS_REGION` | S3 client | `us-east-1` | LOCAL |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 client | LocalStack's documented dummy value `test` locally; on AWS the task role, no static keys | LOCAL |
| `MEDIA_BUCKET` | uploads, probe, GC | `postpipe-media-local` locally; SST output later | LOCAL |
| `MEDIA_CDN_HOST` | signed read URLs | unset locally (S3 presigned GET fallback); `media.postpipe.com` later | LATER |
| `CLOUDFRONT_KEY_PAIR_ID`, `CLOUDFRONT_PRIVATE_KEY` | CloudFront signed URLs | created in Task 6 (Phase D) | LATER |
| Deploy IAM identity | `sst deploy` | owner creates the AWS account and an IAM identity (Phase D) | LATER |

## Platforms (one developer app each)

| Key | Platform | Where it comes from | Blocked by | Status |
|---|---|---|---|---|
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` (the secret also signs inbound events at `app/api/webhooks/tiktok`) | TikTok | developers.tiktok.com, Manage apps, add Login Kit and Content Posting API | nothing for sandbox; audit for public posting (`VERIFICATIONS.md`) | PENDING |
| `TIKTOK_MEDIA_URL_BASE` | TikTok photo posts | https base URL of a domain DNS-verified in the TikTok portal that serves `/media/<id>` without redirects (`integrations/tiktok.md` section 2). Unset = photo posts are rejected (`tiktok_photo_unavailable`). `app/media/[id]/[exp]/[sig]` serves it (signed, see `MEDIA_URL_SIGNING_KEY`) | a verified domain and the media route | LATER |
| `MEDIA_URL_SIGNING_KEY` | TikTok photo pull URLs (`/media/<id>/<exp>/<sig>`, HMAC-SHA256, 24h) | Make one with `openssl rand -base64 32`. Rotate by changing it; this only breaks pull URLs younger than 24h | none | PENDING |
| `META_APP_ID`, `META_APP_SECRET`, `META_LOGIN_CONFIG_ID` | Facebook Pages | developers.facebook.com app, Facebook Login product | Business Verification (in progress) for App Review; dev mode works now | PENDING |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Instagram | Instagram app ID and secret under App Dashboard > Instagram > API setup with Instagram business login (`integrations/instagram.md`; key names are ours, UNVERIFIED in the doc) | same as Meta | PENDING |
| `THREADS_APP_ID`, `THREADS_APP_SECRET` | Threads | Threads use case on the same Meta app; its own app ID and secret (`integrations/threads.md`) | same as Meta | PENDING |
| `X_CLIENT_ID`, `X_CLIENT_SECRET` | X | developer.x.com app, OAuth 2.0, Web App (confidential) | funded pay-per-use account | PENDING |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn | linkedin.com/developers app linked to a Company Page; Share on LinkedIn and Sign In products | Community Management API access for organization posting | PENDING |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | YouTube | Google Cloud project, OAuth client (web), YouTube Data API v3 enabled | OAuth verification and YouTube audit for public videos | PENDING |
| `PINTEREST_APP_ID`, `PINTEREST_APP_SECRET`, `PINTEREST_ENV` (optional: `sandbox` while Trial, else production) | Pinterest | developers.pinterest.com app (Trial); separate sandbox token for `api-sandbox.pinterest.com` | Standard access for public Pins | PENDING |
| `PUBLIC_PLATFORMS` (not a secret; comma list, default `bluesky,x,linkedin`) | which platforms this deployment's own approved apps serve; others need an org's own app | set by the operator; self-hosters with approved apps list all nine | nothing | LOCAL |
| `BLUESKY_OAUTH_PRIVATE_JWK` | Bluesky OAuth, confidential mode (https app URL only; loopback dev needs none) | ES256 private JWK as one JSON line with a `kid`. Make one: `node -e "import('@atproto/oauth-client-node').then(async m=>console.log(JSON.stringify((await m.JoseKey.generate(['ES256'],'k1')).privateJwk)))"`. Public half is served at `/oauth/jwks.json`. Rotation: add a new key with a new `kid`, then remove the old one to end sessions signed with it (`integrations/bluesky.md` section 3) | nothing | GENERATE |
| `BLUESKY_CLIENT_METADATA_URL` | Bluesky | our own public HTTPS URL, which is also the `client_id`; needs a public host, so a tunnel locally or Phase D | public URL | LATER |
| Mock platform | tests, test mode | none | nothing | HAVE |

## Billing

| Key | Used by | Where it comes from | Status |
|---|---|---|---|
| `POLAR_ACCESS_TOKEN` | checkout, usage reporting | Polar dashboard, sandbox organization first | PENDING |
| `POLAR_WEBHOOK_SECRET` | `app/api/billing/webhook` | Polar webhook settings | PENDING |
| `POLAR_ORGANIZATION_ID` | provider module | Polar dashboard | PENDING |
| `POLAR_SERVER` | provider module | `sandbox` until the first production sale, then `production` | LOCAL |
| `POLAR_PRODUCT_BUILDER`, `POLAR_PRODUCT_SCALE` | checkout, webhook plan mapping | Polar dashboard product IDs, sandbox first | PENDING |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Stripe provider | when the owner switches to Stripe | LATER |

## Observability, docs, CI

| Key | Used by | Where it comes from | Status |
|---|---|---|---|
| `SENTRY_DSN` | app and worker; optional, Sentry is off when unset (Phase D) | sentry.io project, free tier | PENDING |
| `SENTRY_ENVIRONMENT` | app and worker; optional, default `development` (Phase D) | name you choose, for example `production` | LATER |
| `SENTRY_AUTH_TOKEN` | source map upload in CI | sentry.io, optional | LATER |
| `NEXT_PUBLIC_POSTHOG_KEY` | dashboard analytics | posthog.com project | PENDING |
| `FERN_TOKEN` | SDK publishing | Fern account; only needed to publish SDKs | LATER |
| npm and PyPI tokens | SDK publishing | owner accounts; ask before first publish | LATER |
| `ANTHROPIC_API_KEY` (GitHub secret) | `claude-review.yml` pull request review | console.anthropic.com | PENDING |
| GitHub deploy key or SSH key | `git push` | owner's GitHub account, SSH | PENDING |

## Log

- 2026-10-27: file created. Nothing collected yet except LOCAL values that `supabase start` and Docker Compose produce on their own.
