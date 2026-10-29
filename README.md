# PostPipe

One API and dashboard to publish to Bluesky, X, LinkedIn, Facebook, Instagram, Threads, TikTok, YouTube and Pinterest.

## Hosted

Use it at https://postpipe.com. Bluesky, X and LinkedIn are available now. The other platforms are coming soon, as PostPipe's own apps get approved. You do not have to wait: you can plug in your own developer app and post through it today, within your app's approval limits. See `/docs/bring-your-own-app`.

## Self-host

Full guide: `/docs/self-host`. In short:

```bash
git clone <this repo> && cd postit
pnpm install
supabase start
cp .env.example .env.local   # set TOKEN_KEY_V1 (openssl rand -base64 32), your platform app keys, PUBLIC_PLATFORMS
docker compose up --build    # then open http://localhost:3000
```

## Develop

```bash
pnpm dev          # Next dev server
pnpm worker       # publish worker
pnpm typecheck
pnpm lint
pnpm test
pnpm test:e2e
pnpm build
```

Local Postgres and Auth run with `supabase start`. Platform notes are in `docs/integrations/`.

## Licence

AGPL-3.0-only. You can self-host it freely. If you run a modified version as a service for others, you must share your changes under the same licence.
