# Ops runbook

For one on-call person. Names only, never secret values. "Phase D, not yet" means it is not built.

## 1. Where to look

- Worker logs: one JSON line per event on stdout (errors on stderr). Fields: `level`, `time`, `msg`. Local: the `pnpm worker` terminal or `docker compose logs worker`.
- Useful `msg` values:
  - `worker.start`, `worker.heartbeat` (every tick, with `publish`, `webhooks`, `jobs`): the worker is alive.
  - `publish.tick`: counts per tick (`claimed`, `success`, `wait`, `retry`, `error`, `quota`, `max_lateness_ms`).
  - `webhook.delivery`: one per delivery attempt (`id`, `event`, `status`, `attempt`, `response_code`).
  - Errors: `worker.stage_failed`, `worker.fatal`, `publish.target_crashed`, `publish.side_effect_failed`, `job.failed`, `token_health.account_failed`, `billing.overage_failed`, `billing.usage_report_failed`.
- Sentry: only when `SENTRY_DSN` is set (Phase D, not yet). The app (Node runtime) and the worker report errors. Request headers, cookies, body and query string are removed before sending. No browser Sentry. No source-map upload, because that needs `SENTRY_AUTH_TOKEN`; stack traces show built code.
- Dashboard: the posts page shows each post and target status and error. Check `GET /api/health` for the app and its `sha`.
- SQL (local): `psql "$DATABASE_URL"`. Tables: `social_post_targets`, `publish_runs` (one row per step, `detail` has the error), `webhook_deliveries`, `webhook_endpoints`, `social_accounts`.

## 2. Alerts

CloudWatch alarms are Phase D, not yet. Until then, check by hand with the logs and SQL below.

### Failed publish rate above 5% in 15 minutes

- Means: many targets end in `error`.
- Check 1: `select error_code, platform, count(*) from social_post_targets where status = 'error' and created_at > now() - interval '15 minutes' group by 1, 2 order by 3 desc;`
- Check 2: logs for `publish.target_crashed` and `worker.stage_failed`.
- Check 3: is one platform down (section 4) or is `account_reauth_required` common (tokens expired)?
- Fix: a platform outage waits and retries by itself. For crashes, read the error, fix, redeploy. Retry single targets with section 3.

### Webhook deliveries dead above 10 per hour

- Means: customer endpoints fail 6 times (`MAX_ATTEMPTS`) or are disabled.
- Check 1: `select endpoint_id, response_code, count(*) from webhook_deliveries where status = 'dead' and created_at > now() - interval '1 hour' group by 1, 2 order by 3 desc;`
- Check 2: `webhook.delivery` logs for that endpoint. `response_code` null means a network error, timeout, or blocked non-public URL.
- Check 3: `select id, url, enabled from webhook_endpoints where id = '<endpoint_id>';`
- Fix: it is usually the customer's endpoint. Tell them. Dead deliveries are not retried by the worker.

### Worker heartbeat missing for 5 minutes

- Means: no `worker.heartbeat` log line. Normal gap is about 10 seconds (`TICK_MS`).
- Check 1: is the process running? (`docker compose ps`; ECS in Phase D, not yet.)
- Check 2: last lines of logs, look for `worker.fatal` or a crash.
- Check 3: can the worker reach Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)?
- Fix: restart the worker (`docker compose restart worker`). Stuck targets are re-claimed after 30 minutes on their own.

### Token decrypt failures

- Means: the log or error text `token decrypt failed`, from `lib/crypto/tokens.ts`. The key is missing or wrong, or the blob is damaged.
- Check 1: which key version? Blobs look like `v<n>.…`. Query `select key_version, count(*) from social_accounts group by 1;`
- Check 2: does `TOKEN_KEY_V<n>` exist in the environment (or AWS Secrets Manager `postpipe/<stage>/TOKEN_KEY_V<n>` when `SECRETS_SOURCE=aws`)? A missing key shows `MissingSecret: TOKEN_KEY_V<n>`.
- Check 3: was a key removed or changed lately? See section 5.
- Fix: restore the old key. Never delete an old key while rows still use it. If one blob is damaged, the customer must reconnect that account.

### ECS running task count below desired

Phase D, not yet. For now: `docker compose ps` shows app and worker running.

### Budget alarm at $50

Phase D, not yet (AWS Budgets). Local runs cost nothing.

## 3. A stuck target

Statuses: `pending`, `running`, `success`, `error`, `cancelled`.

Find targets that are late or locked:

```sql
select id, post_id, platform, status, attempts, next_attempt_at, locked_at, error_code
from social_post_targets
where status in ('pending', 'running')
  and (next_attempt_at < now() - interval '15 minutes'
       or locked_at < now() - interval '30 minutes')
order by next_attempt_at;
```

How the claim works (`claim_due_targets`, migration `0011_review_fixes.sql`): the worker takes due rows with `for update skip locked` and sets `locked_at`. A row whose `locked_at` is older than 30 minutes is claimable again, even if it is `running`. If a reclaimed `running` row has a `publish_state`, `attempts` goes up by 1. The post must be `scheduled` or `processing`. A target that passes 6 attempts (`MAX_ATTEMPTS`) fails with `max_attempts_exceeded`.

So most stuck targets fix themselves within 30 minutes. If not:

- Check the parent post: `select status from social_posts where id = '<post_id>';`. A `cancelled`, `failed` or `completed` post is never claimed.
- Retry now (safe, only if the target is not `running` on a live worker): `update social_post_targets set status = 'pending', locked_at = null, next_attempt_at = now() where id = '<id>' and status in ('pending', 'error');`
  - Danger: a target with a `publish_state` was part-way through on the platform. Clearing `publish_state` can post twice. Keep `publish_state` unless you checked the platform.
  - For `error` targets, the parent post may need `status = 'processing'` so the claim accepts it.
- Cancel: `update social_post_targets set status = 'cancelled', locked_at = null where id = '<id>' and status in ('pending', 'error');` Then rollup the post: `select rollup_post_status('<post_id>');` (service role).
- Look at the steps: `select step, status, detail from publish_runs where target_id = '<id>' order by started_at;`

## 4. A platform outage

- See it: many targets with the same `platform` and `error_code` such as `network_error` or `internal_error` (query in section 2, first alert). `publish_runs.detail` has `code`, `kind`, `message`. Real platform adapters and their codes are listed in `docs/integrations/<platform>.md`; check the platform status page too.
- Error kinds: `retryable` (try again), `permanent` (fail now), `auth` (mark the account `expired`, fail with `account_reauth_required`).
- What the worker does: a `retryable` error sets the target back to `pending` and waits, by attempt: 30 s, 2 min, 10 min, 30 min, 2 h (`RETRY_LADDER_MS`), then 2 h again. If the platform sends a retry-after, the longer wait wins. After 6 attempts (`MAX_ATTEMPTS`) the target becomes `error`. A daily platform quota sets `daily_quota_reached` and waits until UTC midnight.
- Long outage (over about 4 hours): targets that used all 6 attempts are in `error`. After the outage, retry them as in section 3.
- Tell customers: the platform is down on their side; we retry for about 5 hours and then mark the post failed; failed posts can be sent again; no action needed for posts still `pending`. Do not promise a time.

## 5. Key rotation

Names only. Values live in `.env.local`, or in AWS Secrets Manager (`postpipe/<stage>/<NAME>`, Phase D, not yet).

- Token encryption key (`TOKEN_KEY_V<n>`, `CURRENT_TOKEN_KEY_VERSION`):
  1. Make a new key: `openssl rand -base64 32`.
  2. Add it as `TOKEN_KEY_V<n+1>`. Keep `TOKEN_KEY_V<n>`.
  3. Set `CURRENT_TOKEN_KEY_VERSION=<n+1>`. Restart app and worker.
  4. New writes use the new key (`currentKeyVersion()`). Old blobs still decrypt, because the version is read from the blob (`keyVersionOf`).
  5. Rows move on their next token refresh (`access_token_enc`, `refresh_token_enc`, `key_version` in `social_accounts`). Webhook `secret_enc` in `webhook_endpoints` and `client_secret_enc` in `platform_apps` (an org's own developer app secret) use the same key and do not move by themselves.
  6. A re-encrypt job (`lib/jobs/reencrypt-tokens.ts`) does not exist yet. Remove an old key only when `select count(*) from social_accounts where key_version < <n+1>;` is 0, `select count(*) from platform_apps where key_version < <n+1>;` is 0 and webhook secrets are re-created. A `platform_apps` secret moves when the org saves its app again in Settings.
- API keys (`api_keys`): the customer makes a new key in the dashboard, switches over, then revokes the old one (sets `revoked_at`). Only the hash (`key_hash`) is stored; a lost key cannot be shown again. If a key leaked: revoke it first.
- Webhook endpoint secrets (`webhook_endpoints.secret_enc`): there is no rotate call. Create a new endpoint (`POST /api/v1/webhooks`), switch the customer, delete the old endpoint.
- Polar: `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`. Make a new value in the Polar dashboard, update the environment, restart, then revoke the old one. For the webhook secret, update both sides in one step; events sent in between fail and Polar retries them.
- Supabase service role (`SUPABASE_SERVICE_ROLE_KEY`): rotate in the Supabase project settings, update the environment, restart app and worker at once. Both fail until they have the new key.
- Full list of keys: `docs/ops/keys-registry.md`.

## 6. Rollback

- App and worker images: redeploy the previous image tag in ECS. Phase D, not yet. Local: `git checkout <old sha>` and `docker compose up --build`.
- Database: migrations are forward-only. Do not edit or delete a migration that was applied. Write a new migration in `supabase/migrations/` that undoes the change. Local reset (`supabase db reset`) wipes data and needs approval.
- Pause the worker: stop it. Locally `docker compose stop worker`. On ECS set the worker service desired count to 0 (Phase D, not yet). Posts stay `pending`; nothing is lost. On `SIGTERM` the worker finishes the current tick, then exits. Start it again to resume; late targets publish at once.

## 7. Golden path e2e

`tests/e2e/golden-path.spec.ts` publishes one real post to a Bluesky test account. It skips unless the Bluesky vars are set. It starts `pnpm worker` itself.

1. Set `BLUESKY_TEST_HANDLE` and `BLUESKY_TEST_APP_PASSWORD` in `.env.local` (app password, not the main password).
2. Optional, for the webhook check: pick a port, set `E2E_WEBHOOK_PORT`. Run `cloudflared tunnel --url http://localhost:<E2E_WEBHOOK_PORT>` (install cloudflared yourself). Put the printed `https://` URL in `E2E_WEBHOOK_PUBLIC_URL`. The webhook url guard rejects localhost, so the tunnel is needed.
3. Start `supabase start`, the LocalStack container and `pnpm dev`. Then run `node --env-file-if-exists=.env.local node_modules/@playwright/test/cli.js test golden-path --reporter=line`.
4. The test post stays on Bluesky (there is no delete path). Delete it by hand. The caption starts with "PostPipe e2e automated test".
