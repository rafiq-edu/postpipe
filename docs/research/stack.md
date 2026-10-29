# Postit stack research

Written 2026-10-27. Scope: stack choices for a unified social publishing API. Facts come from official pages read on 2026-10-27. Cost figures for Postit are my estimates. Anything not confirmed is marked UNVERIFIED.

Assumptions for cost: average 3 social accounts per post, about 25 Workflow events per account publish (about 8 steps, 3 events per step; UNVERIFIED guess), average media 20 MB, media deleted 30 days after publish.

> **Decision update 2026-10-27 (owner):** hosting is AWS from the start, not Vercel. The Vercel findings below stay as research. Deployment itself is deferred (owner, 2026-10-27): development runs in Docker Compose. The AWS shape for later is in the spec section 5: one container image on ECS Fargate (`web` and `worker` services) through SST v3, S3 plus CloudFront for media, Secrets Manager, CloudWatch, Route 53. Fargate list price about $0.04048 per vCPU-hour and $0.004445 per GB-hour (us-east-1); an Application Load Balancer about $16 per month plus usage. AWS cost lines in the spec are estimates from public list prices, not yet measured; Task 6 and Task 34 record real numbers under "Measured (AWS)" below.

## A. Recommendation table

| Component | Choice | Why (one line) | $/mo at 0 | $/mo at 10k posts | $/mo at 100k posts |
|---|---|---|---|---|---|
| App host | Vercel Pro, Next.js, Fluid Compute | Needed for commercial use, 800s functions, 1-minute cron | 20 (0 on Hobby while building) | 20 | 20 |
| Scheduler and worker | Vercel Workflow (GA, `workflow` package) | Durable sleep to exact time, retries, dashboard, no new vendor | 0 | 15 (events) | 150 (events) + 20-60 compute |
| Database, auth | Supabase Pro | Postgres, Auth, RLS in one place | 25 (0 on Free while building) | 25 | 25-50 |
| Media storage | Cloudflare R2 | Free egress, S3 presigned URLs, public bucket | 0 | 1 | 10-30 |
| Token encryption | App-level AES-256-GCM, versioned keys in Vercel env | No vendor, rotation we control | 0 | 0 | 0 |
| API keys | SHA-256 hash plus prefix in Postgres | Keys are random, so fast hash is enough | 0 | 0 | 0 |
| Rate limit | Upstash Ratelimit, plus Vercel WAF for per-IP | WAF cannot key on API key on Pro | 0 | 0 | 2-5 |
| Webhooks out | Build our own on Workflow | Retries already exist; Svix costs more | 0 | 0 | 0 |
| SDKs | Fern free (TypeScript, Python); openapi-generator as backup | Only free option with a clear tier today | 0 | 0 | 0 |
| API docs | Fumadocs (self-host in Next.js) | MIT, no fee, no vendor | 0 | 0 | 0 |
| Billing | Polar.sh (merchant of record) | Pays out to Saudi Arabia, Egypt, UAE; handles VAT | 0 | fee per sale | fee per sale |
| Errors | Sentry free, then Team | Free tier fits launch | 0 | 0 | 26-29 |
| Logs | Axiom free | 500 GB/mo ingest, 30 days | 0 | 0 | 0-25 |
| **Total (excl. billing fees)** | | | **45 live (0 dev)** | **about 50-65** | **about 300-400** |

Billing fees are a share of revenue, not a fixed cost. Polar Starter takes 5% + $0.50 per sale.

Vercel Pro includes a $20 monthly usage credit, so part of the Workflow and compute cost is covered. I did not subtract it.

## B. Findings per question

### 1. Vercel Workflow (Workflow SDK)
- Status: GA since 2026-04-16 (search result summarizing the Vercel blog "A new programming model for durable execution"). The docs page was last updated 2026-09-04. The `workflow` npm package is stable.
- Careful: multi-region needs `workflow` 5.0.0-beta.33 or later. Runs made by 4.x always live in `iad1`. Pin one version. Do not use 5 beta in production without a test.
- Directives `'use workflow'` and `'use step'` are confirmed in the docs.
- Step runtime: set by Vercel Functions limits. Pro max is 800s (GA), 1800s (beta). Hobby 300s. Split a big upload into many steps.
- Sleep: no maximum duration. No maximum run duration. Exact precision of a wake-up time: UNVERIFIED. Test it.
- Retries: default 3 retries (4 attempts), no backoff by default. `RetryableError` with `retryAfter` sets a delay. `FatalError` stops retry. (workflow-sdk.dev errors page)
- Concurrency: up to 100,000 on the docs page. The functions page says auto-scale to 30,000 for Hobby and Pro. Use 30,000 as the safe number.
- Limits per run: 25,000 events, 10,000 steps, 50 MB payload, 2 GB storage, 240s max replay time. 1,000 run creations per second.
- Rate limits: 500,000 requests per minute on Pro. Over the limit, calls retry with backoff, they do not fail.
- Pricing: $0.02 per 1K events, $0.50 per GB written, $0.50 per GB-month retained. Hobby gets 50,000 events and 1 GB free. A normal step makes 3 events. A retry adds 1 event. Functions are billed at normal compute rates. Queues are billed too (see 2).
- Observability: dashboard Observability > Workflows, with traces, inputs, outputs, errors.
- Open source: Worlds can be Local, Postgres or Vercel (workflow-sdk.dev). So there is an exit path.
- Fit: good. One parent run per post, one child run per account. Child sleeps until the scheduled time, then steps: fetch media, upload chunks, create container, poll, publish, save result, send webhook. Keep DB as source of truth. Batch small work into one step to save events.

### 2. Vercel Queues
- Status: Beta on all plans (docs updated 2026-09-03). Not GA.
- Limits: message TTL 60s to 7 days (default 24h). Delay up to 7 days. Visibility timeout up to 60 min. Max message 100 MB. Max 10 messages per receive. Unlimited topics and consumer groups. After 32 attempts, forced backoff.
- Pricing: per API operation, 4 KiB chunks. Hobby gets 1,000,000 operations. Pro rate is regional and not shown on the page: UNVERIFIED number.
- Fit: it is what Workflow runs on. Use it directly only for simple fan-out. A Beta API is a risk. Skip it for Postit.

### 3. Vercel Cron Jobs
- Hobby: 100 jobs per project, once per day, timing can be off by up to 59 minutes.
- Pro and Enterprise: 100 jobs per project, once per minute, per-minute precision.
- No extra price. You pay for the function that runs. (docs updated 2026-07-15)
- Use: a safety sweep every minute that finds posts the scheduler missed.

### 4. Fluid Compute limits (docs updated 2026-08-24)
- Max duration: Hobby 300s. Pro and Enterprise: default 300s, max 800s GA, 1800s beta.
- Memory: Hobby 2 GB / 1 vCPU. Pro 2 GB default, 4 GB / 2 vCPU max.
- Request or response body of a function: 4.5 MB. Error 413 FUNCTION_PAYLOAD_TOO_LARGE.
- Concurrency: auto-scale to 30,000 on Hobby and Pro.
- Price (iad1): $0.128 per active CPU hour, $0.0106 per GB-hour of memory. Waiting on network does not bill CPU but does bill memory. Pro: $20 per month with $20 credit. Hobby: 4 CPU hours, 360 GB-hours, 1M invocations. Vercel Hobby is for non-commercial use (Vercel terms; I did not re-read them today, UNVERIFIED).
- 500 MB video: yes, it can work. The 4.5 MB limit is for what the function receives or returns, not for outbound fetches. The function should never send the video back to a client. Read it from R2 with HTTP Range requests, one chunk per Workflow step (for example 8-64 MB), and push each chunk to the platform. Memory stays small. Total time at 10 MB/s is about 50s, far below 800s. The speed to each platform API is UNVERIFIED. Each platform has its own chunk size rules (check TikTok, YouTube docs before coding).
- Never accept uploads through a function. Use presigned URLs so the browser sends files straight to storage.

### 5. Scheduler alternatives
| Option | Precision | Retries | Long uploads | Cost 10k posts | Cost 100k posts | Lock-in | Ops burden |
|---|---|---|---|---|---|---|---|
| Vercel Workflow | Durable sleep to a date; second-level UNVERIFIED | Built in, custom backoff | Per step up to 800s, chunk it | about 15 + compute | about 150 + compute | Medium; open SDK, Postgres World exists | Low |
| Trigger.dev v4 | Delayed runs; precision UNVERIFIED | Built in | No max duration (own machines) | Hobby 10 + runs 0.75 + compute | Pro 50 + runs 7.50 + compute (compute rate UNVERIFIED) | Medium | Low; second vendor |
| Inngest | Sleep until a date; UNVERIFIED | Built in | Steps run in your Vercel function, same 800s | Pro 99 (180k steps over free 50k) | Pro 99 + overage (about 1.8M executions) | Medium | Low; most costly at low volume |
| Upstash QStash | Delay to a time; max 7 days free, 1 year pay-as-you-go | Built in; each retry is billed | HTTP call to our function, response timeout 2h on pay-as-you-go | about 0.30 (30k msgs at $1 per 100K) | about 3 | Low | We write state and polling ourselves |
| Supabase pg_cron + pgmq | pg_cron runs jobs every second; keep at most 8 jobs at once, each under 10 min | We build it | pg_net calls our function; same 800s | 0 (in Supabase bill) | 0 | Low | High; we build locks, backoff, dashboard |
| Railway + BullMQ | Delayed jobs with Redis; very precise | Built in | No limit | about 30 (0.5 vCPU + 1 GB ≈ 15, plus Redis) | about 30-60 | Low | Highest; deploys, Redis storage, monitoring, alerts |

Numbers: Trigger.dev Free $0 ($5 credit, 20 concurrent runs), Hobby $10 (50 concurrent), Pro $50 (200+), $0.000025 per run. Inngest Free 50k executions and 5 concurrent steps, Pro from $99 with 1M executions, overage $0.000050 down to $0.000015 each. QStash Free 1,000 messages per day, $1 per 100K. Railway Hobby $5, Pro $20, $20 per vCPU-month, $10 per GB-month. Fly.io cost: UNVERIFIED (not read).

Recommendation: Vercel Workflow.
- It is already in our stack, so no second vendor, no second bill, one dashboard.
- Durable sleep until the post time, retries with custom delay, steps that survive deploys.
- Concurrency is high. Trigger.dev Free caps at 20 runs at once, which hurts when many posts are due at 09:00.
- Exit path: the SDK is open source and has a Postgres World.
- Weak point: event cost grows linearly. At 100k posts it is about $150 a month. Cut it by batching steps. If cost hurts, move to Trigger.dev Pro, which is cheaper at that size.
- Add a Pro cron sweep each minute as a safety net.

### 6. Media storage
| | Supabase Storage | Vercel Blob | Cloudflare R2 | AWS S3 |
|---|---|---|---|---|
| Storage per GB-month | $0.0213 over 100 GB (Pro) | $0.023 (Pro) | $0.015 (10 GB free) | about $0.023 UNVERIFIED (page did not list) |
| Egress per GB | $0.09 over 250 GB; cached $0.03 | Blob Data Transfer: $0.05 in iad1 (pricing example) | Free | about $0.09 UNVERIFIED; first 100 GB free per month |
| Max object size | 50 MB Free; 500 GB Pro | 5 TB; multipart advised above 100 MB | UNVERIFIED (not on page) | 5 TB UNVERIFIED (not on page) |
| Direct browser upload | Signed upload URLs and resumable (TUS); S3 page 404, S3 presign UNVERIFIED | Client uploads, no transfer charge | S3 presigned PUT (S3 API; confirm in docs) | Presigned PUT |
| Public URL | Public bucket | Public store | Public bucket via r2.dev or custom domain | Public bucket or CloudFront |
| Signed temporary URL | Yes | Private store; details not read | Presigned GET | Presigned GET |
| Ops price | included | $0.40 per 1M reads, $5 per 1M writes | $4.50 per 1M Class A, $0.36 per 1M Class B | per request |

- Meta and Pinterest must fetch media from a public URL. Each fetch is egress, so egress price matters. At 100k posts, 3 accounts, 20 MB: about 6 TB per month. Supabase egress would be about $500. R2 is $0.
- Choice: R2. Public bucket on a custom domain for platform fetches. Presigned PUT for customer uploads. Presigned GET for our own reads.
- Rule: use an unguessable object key. Delete the object after the retention period.
- Source: developers.cloudflare.com/r2/pricing, vercel.com/docs/vercel-blob/usage-and-pricing, supabase.com/pricing.

### 7. OAuth token encryption at rest
- Supabase Vault: authenticated encryption (libsodium AEAD). Key per project, kept outside the database. Docs do not describe key rotation (UNVERIFIED if possible). Anyone with SQL access (service role) can read `vault.decrypted_secrets`. The root key can be exported via Management API.
- Vercel KMS: Beta. It only signs JWTs and messages. It does not support encryption or symmetric keys. Not usable.
- App-level AES-256-GCM: Node `crypto`, no new dependency. Random 12-byte IV per value. Store `v1:iv:ciphertext:tag`.
- Recommendation: app-level AES-256-GCM. Keys in Vercel env as `TOKEN_KEY_V1`, `TOKEN_KEY_V2`, marked sensitive. An attacker with only DB access gets nothing.
- Rotation: add `TOKEN_KEY_V2`, set it as current for new writes, keep V1 for reads, run a background job that decrypts with the version prefix and re-encrypts as V2, then remove V1 after zero rows use it. Rotate on staff change or suspected leak, and once a year.
- Also: never log tokens. Keep refresh tokens in a separate table with no public RLS access.

### 8. API key auth and rate limiting
- Key format: `pk_live_<8-char prefix>_<32 random bytes, base62>`. Show the full key once. Store prefix (indexed), SHA-256 hash, last used time, revoked flag. Look up by prefix, compare hash with `timingSafeEqual`. SHA-256 is fine because the key has high entropy. Slow hashes (bcrypt) add cost with no gain.
- Vercel WAF rate limiting: all plans, GA. Pro keys are only IP and JA4. Header keys (for API key) are Enterprise only. Fixed window only on Pro, window 10s to 10 min, 40 rules per project. Price is usage-based and regional (rate UNVERIFIED). Counters are per region.
- Upstash Ratelimit: needs Redis. Free 500K commands per month. Then $0.20 per 100K commands. Max request 10 MB. Cost at 100k posts is a few dollars. Ratelimit package needs `@upstash/ratelimit` (new dependency, ask before adding).
- Postgres counter: free, no new service, but adds a write per request. Fine below about 50 requests per second.
- Choice: WAF rule for IP abuse on auth routes, Upstash for per-key limits.

### 9. Outbound webhooks
- Svix: Free $0 with 50,000 messages/month, 7-day payload retention. Basic from $20 with 30 days. Professional from $490. Overage $0.0001 per message. Retries are free and use exponential backoff. Each 64 KiB chunk counts as one message.
- Cost with Svix at 100k posts: say 300k events, about $20 + 250k × $0.0001 = $45.
- Build our own: HMAC-SHA256 over `timestamp.body`, headers `webhook-id`, `webhook-timestamp`, `webhook-signature` (Standard Webhooks layout), 5-minute replay window. Delivery as a Workflow with `RetryableError` and exponential backoff (for example 10s, 1m, 10m, 1h, 6h, 24h). After the last try, mark `dead` in `webhook_deliveries` and offer a replay button in the dashboard. Auto-disable an endpoint after N days of failures. About 1-2 days of work.
- Choice: build our own. Svix is the fallback if customers ask for a portal.

### 10. SDK generation
| Tool | Free tier | Paid | Languages |
|---|---|---|---|
| Stainless | WINDING DOWN: announced 2026-05-18 it joins Anthropic; no new signups | none | not applicable |
| Speakeasy | 1 SDK, up to 50 API methods, 14-day business trial. Generators AGPL-3.0 since 2026-09-17 | public price unclear (older sources: $250-600 per language) | TypeScript, Python, Go, Java, C#, PHP, Ruby, Swift, Unity, Terraform |
| Fern | TypeScript and Python SDKs up to 200 endpoints; docs free for 10 members, 1,000 pages (Sept 2026 comparison) | Enterprise only, per SDK | other languages Enterprise; Fern now part of Postman |
| openapi-generator | Free, open source | none | 50+ targets, quality differs per target (count UNVERIFIED) |

- Choice: Fern free for TypeScript and Python. Keep the OpenAPI file clean so we can switch. Backup: openapi-generator.
- Read the Fern pricing details again before launch; sources disagree.

### 11. API docs hosting
| Tool | Price | OpenAPI |
|---|---|---|
| Mintlify | Starter $0 (5 editor seats); Pro $450/mo annual, $540 monthly | API playground on all plans (OpenAPI named only in general knowledge, UNVERIFIED) |
| Scalar | Free (no custom domain, 3 APIs); Pro $150/mo; Business $600/mo | Native OpenAPI reference on all plans |
| Redocly | Pro $249/mo, Scale $729/mo, 30-day trial, no free plan | Native OpenAPI |
| Fumadocs | Free, open source, runs in our Next.js app | `fumadocs-openapi` package; page fetch returned 404, so UNVERIFIED |

- Choice: Fumadocs. Zero fee, same deploy, our domain. If the OpenAPI plugin is weak, use Scalar Free for the reference and Fumadocs for guides. Or use Fern free docs.

### 12. Billing (money decision)
Fees:
| Provider | Fee | Merchant of record (VAT and sales tax) | Notes |
|---|---|---|---|
| Polar.sh | Starter 5% + $0.50; Pro ($20/mo) 3.8% + $0.40; Growth ($100/mo) 3.6% + $0.35; Scale ($400/mo) 3.4% + $0.30. +1.5% for non-US cards. $15 per dispute. | Yes | Payout fees are Stripe's: $2/mo active, 0.25% + $0.25 per payout, currency conversion 0.25-1% |
| Lemon Squeezy | 5% + $0.50, some non-US extras | Yes | Stripe-owned; support slower, users pushed to Stripe Managed Payments (search summary) |
| Paddle | 5% + $0.50, no monthly fee | Yes | Software only; must pass review |
| Stripe direct | UAE: 2.9% + AED 1.00 domestic cards; +1% international; +1% conversion; Billing 0.7%; Tax 0.5% | No. We register and file tax ourselves (Stripe Tax only calculates) | Stripe account creation: UAE yes. Saudi Arabia no. Egypt no (stripe.com/global) |

Payout availability:
- Polar: lists Saudi Arabia, Egypt and United Arab Emirates under "Payouts" in supported countries. Paid out through Stripe Connect Express; Stripe Payments in your country is not required. Real payout success in Egypt or Saudi Arabia: UNVERIFIED until a test.
- Lemon Squeezy: docs list Egypt, Saudi Arabia, United Arab Emirates for bank payouts. Payouts twice a month (1st and 15th). PayPal payout also exists, but Egypt may not be on PayPal's payout list (third-party claim, UNVERIFIED). Use bank wire.
- Paddle: sells to buyers in all three countries. Seller payout countries: no official list found. Third-party list says Egypt works. Saudi Arabia and UAE UNVERIFIED. Ask Paddle support.
- Stripe: only the UAE works for a founder there. If you live in Saudi Arabia or Egypt you cannot open a Stripe account directly (no company in a supported country).

Recommendation: Polar.sh.
- It is a merchant of record, so it collects and files VAT and sales tax. That removes the largest legal work for a solo founder.
- Payouts cover all three countries on its list.
- Cheapest of the three merchants of record at scale (3.4% + $0.30 on Scale vs 5% + $0.50). Early Member pricing (4% + $0.40) applies only to organisations created before 2026-05-27, so a new account pays Starter or a paid tier. At $29 per month plan: Starter fee = $1.95 (6.7%). Pro tier ($20/mo) fee = $1.50 (about 5.2%) plus $20, so it pays off after about 12 sales at that price.
- Risk: Polar is younger than Paddle. Check that "social media posting API" is accepted by its acceptable-use rules: UNVERIFIED.
- Do a small real test: create the account, pass identity checks, run a $1 sale, request a payout. Do this before building billing code.
- Fallback order: Lemon Squeezy (bank wire), then Paddle after written confirmation.
- If the founder is in the UAE, Stripe is possible and a bit cheaper, but we would own tax. Not advised at this stage.
- Not legal or tax advice. Ask an accountant about local tax on the payouts.

### 13. Observability
- Sentry Developer (free): 5k errors, 5M spans, 50 replays, 1 user. Team $26/mo annual or $29 monthly: 50k errors, 5M spans, 50 replays, unlimited users. (sentry.io/pricing; reset period not stated)
- Vercel Observability: includes Workflows traces, Blob usage. Price and retention of general Observability: UNVERIFIED.
- PostHog free tier: pricing page fetch failed. UNVERIFIED. Do not plan on it for launch; use Vercel analytics or nothing.
- Axiom: Personal free 500 GB/mo ingest, 30-day retention. Cloud $25/mo plus usage with 1 TB included.
- Better Stack: free 3 GB logs, 3 days retention, 10 monitors. Paid telemetry from about $25-30 per month, responder seat $29 per month.
- Choice: Sentry free + Axiom free. Add Better Stack free uptime monitors on the API health route. Use the Vercel log drain if the plan allows it (UNVERIFIED).

### 14. Supabase
- Pro: from $25 per month. Includes 8 GB disk per project (then $0.125/GB), 100 GB file storage (then $0.0213/GB), 250 GB egress (then $0.09/GB), 250 GB cached egress (then $0.03/GB), 100,000 MAU (then $0.00325), $10 compute credit covering one Micro instance, daily backups for 7 days. Free: 500 MB database, 1 GB storage, 5 GB egress, 50,000 MAU, max 50 MB uploads, pauses after 1 week idle. (supabase.com/pricing)
- Pooling: Supavisor transaction mode on port 6543 for serverless. Use pool size 1 per instance, create the client once at module scope, disable prepared statements, SSL require. Session mode on port 5432 is IPv4 and for persistent servers. Direct connection is IPv6 unless you buy the IPv4 add-on; use it for migrations only. Dedicated pooler (paid) is also on 6543. Vercel-specific helper for Fluid Compute pools: UNVERIFIED. Connection limits per compute size: not read.
- Auth: email, password, OAuth for dashboard users; 50k MAU Free, 100k Pro. Use `@supabase/ssr`. Server code should call `getUser()` or `getClaims()`, not trust `getSession()`.
- RLS: turn on for every table in `public`. Customer data tables keyed by `workspace_id`. Our publish workers use the service role on the server only. Never expose the service key.
- pg_cron: available. Jobs can run every second. Keep at most 8 jobs concurrent, each under 10 min. Jobs can call HTTP, for example an Edge Function. Good for retention cleanup and the safety sweep.
- Supabase Queues (pgmq): exists, built on Postgres, exactly-once within a visibility window. Release stage not stated.
- Storage: see 6. We will use R2 for media; Supabase Storage is only needed for small avatars if any.

## C. Rejected alternatives
- Vercel Queues direct: Beta, and Workflow already uses it.
- Vercel Cron as the only scheduler: one-minute grid, no state, no retries. Keep it only as a sweep.
- Vercel KMS: signing only, Beta, no encryption.
- Supabase Vault for OAuth tokens: no documented rotation, SQL access reads secrets.
- Vercel Blob: egress $0.05/GB at 100k posts (about $300). Fine product, wrong cost.
- Supabase Storage for media: $0.09/GB egress above 250 GB.
- S3: egress about $0.09/GB (UNVERIFIED). Needs AWS account and CloudFront.
- Inngest: $99 floor, steps count as executions.
- Trigger.dev: good fallback, but second vendor and low free concurrency (20).
- QStash: cheapest, but we hand-build step state and polling. Good for a simple second plan.
- pg_cron + pgmq as main: we would rebuild retries, locks and a dashboard.
- Railway/Fly + BullMQ: always-on cost and the most operations work. Revisit only if upload steps exceed 800s.
- Svix: $20 floor and growing; build our own first.
- Stainless: winding down, no new signups.
- Speakeasy: 50 method cap on free; paid price unclear.
- Mintlify Pro ($450+), Redocly ($249+), Scalar Pro ($150+): money we do not need to spend now.
- Stripe direct: no Saudi or Egypt accounts, and we would own VAT filing.
- Lemon Squeezy: works, but product is being folded into Stripe; slower support.
- Paddle: payout countries not confirmed; strict software review.

## D. Risks and unknowns
- Workflow event cost grows with volume (about $150 at 100k posts under my guess of 25 events per account publish). Measure real event count in a prototype in week 1.
- Workflow 5 beta needed for multi-region. Pin versions and read release notes before upgrades.
- Exact timing of Workflow sleep wake-ups: UNVERIFIED. Test with 100 posts scheduled to the same second. If late by more than a few seconds, add a pre-wake step.
- Event limit of 25,000 per run and 240s replay: keep one run per account publish, not per large batch.
- Polar acceptance for this business type and real payouts to Egypt or Saudi Arabia: UNVERIFIED. Run the $1 test first.
- Paddle and Lemon Squeezy payout lists may change. Founder country is not confirmed.
- Vercel Hobby is non-commercial (not re-checked today). Pro $20 is needed before taking money.
- Platform rules (TikTok audit for public posts, Meta app review, YouTube quota of 10,000 units per day) are outside this document and can block launch more than any stack choice. Not researched here.
- R2 max object size and S3 presign details: UNVERIFIED on pages read. Meta and Pinterest fetch from public URLs: confirm they accept r2.dev or custom domain, with content-type and range support.
- Fern after the Postman acquisition: free tier terms may change. Keep the OpenAPI file as the source.
- Upstash Ratelimit and any SDK are new dependencies. Ask before installing.
- Third-party claims (Stainless wind-down date, Fern tier, Lemon Squeezy PayPal list) come from web search summaries, not the vendor pages. Re-check before relying on them.
- Costs at 10k and 100k are my estimates from list prices, not quotes.

## E. Sources (Read on 2026-10-27)
- https://vercel.com/docs/workflows (page updated 2026-09-04)
- https://vercel.com/docs/workflows/pricing (updated 2026-09-16)
- https://vercel.com/blog/a-new-programming-model-for-durable-execution (GA date via search summary)
- https://workflow-sdk.dev/docs/foundations/errors-and-retries
- https://vercel.com/docs/queues and /docs/queues/pricing (updated 2026-09-03, 2026-08-12)
- https://vercel.com/docs/cron-jobs/usage-and-pricing (updated 2026-07-15)
- https://vercel.com/docs/functions/limitations (updated 2026-08-24)
- https://vercel.com/docs/functions/usage-and-pricing (updated 2026-06-16)
- https://vercel.com/pricing
- https://vercel.com/docs/vercel-blob/usage-and-pricing (updated 2026-09-23)
- https://vercel.com/docs/kms
- https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting (updated 2026-08-28)
- https://trigger.dev/pricing and https://trigger.dev/docs/machines
- https://www.inngest.com/pricing
- https://upstash.com/pricing/qstash and https://upstash.com/pricing/redis
- https://docs.railway.com/reference/pricing/plans
- https://supabase.com/pricing
- https://supabase.com/docs/guides/cron
- https://supabase.com/docs/guides/queues
- https://supabase.com/docs/guides/database/vault
- https://supabase.com/docs/guides/database/connecting-to-postgres
- https://developers.cloudflare.com/r2/pricing/
- https://aws.amazon.com/s3/pricing/ (rates not listed on the page)
- https://polar.sh/resources/pricing
- https://polar.sh/docs/merchant-of-record/supported-countries
- https://www.lemonsqueezy.com/pricing
- https://docs.lemonsqueezy.com/help/getting-started/supported-countries
- https://www.paddle.com/pricing
- https://www.paddle.com/help/start/intro-to-paddle/which-countries-are-supported-by-paddle
- https://developer.paddle.com/concepts/sell/supported-countries-locales/ (search result)
- https://stripe.com/global
- https://stripe.com/en-ae/pricing
- https://www.svix.com/pricing/
- https://www.stainless.com/pricing and https://scalar.com/resources/stainless-wind-down (search result)
- https://www.speakeasy.com/pricing and https://www.speakeasy.com/blog/comparison-sdk-generators-openapi (search result)
- https://buildwithfern.com/pricing (page fetch truncated; figures from search summary)
- https://mintlify.com/pricing
- https://scalar.com/pricing
- https://redocly.com/pricing
- https://sentry.io/pricing/
- https://posthog.com/pricing (fetch failed, UNVERIFIED)
- https://betterstack.com/pricing
- https://axiom.co/pricing

## Measured (AWS)

- (filled by Task 6 and Task 34)

## Measured (local)

- Publish lateness (Task 15, 2 workers, 10 s poll, mock adapter, local Supabase): a post scheduled 20 s ahead started 6.0 s after `scheduled_at`; the poll bounds it at 10 s.
- (Task 34 adds more)

## Load and lateness benchmark (2026-10-28, local)

Machine: arm64 (`uname -m`), Docker with 14 CPUs and 7.7 GiB memory. Local Supabase, 2 worker containers (`docker compose up -d --build --scale worker=2`), mock adapter in live mode.
Run: `pnpm load:test`. 1,000 posts, one target each, 10 accounts, all due at the same minute. Lateness = `published_at - scheduled_at`.

| Run | Settings | p50 | p95 | max | drain | errors |
|---|---|---|---|---|---|---|
| Baseline | `WORKER_CONCURRENCY=5`, 10 s sleep after every tick | 63.0 s | 195.3 s | 245.9 s | 247.7 s | 0 |
| After change | `WORKER_CONCURRENCY=25` (compose), no sleep after a full batch | 10.0 s | 13.2 s | 13.5 s | 13.9 s | 0 |

Target (p95 under 60 s, zero errors): baseline missed, after change met. Postgres connections were not seen as a limit.
Task 37 must repeat the same run on AWS (same script, same worker count and settings) and measure cost.
