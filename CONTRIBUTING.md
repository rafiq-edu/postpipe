# Contributing

- Branch from `dev`.
- Before a pull request run `pnpm typecheck && pnpm lint && pnpm test`.
- Format and lint with Biome (`pnpm lint`).
- One adapter per platform in `lib/platforms/`: pure functions over `fetch`, no database access.
- Schema changes are migration files in `supabase/migrations/`, with pgTAP tests in `supabase/tests/`.
- Contributions are licensed under AGPL-3.0-only.
