# Postit documentation

Postit is the code name; the product and brand name is PostPipe (decided 2026-10-27, domain `postpipe.com`). It is a unified social media publishing API and dashboard (Post for Me style). This folder holds everything written before code. Dates are in file names or headers. Facts marked UNVERIFIED were not confirmed in official documentation and must be tested against a real developer account before code relies on them.

## Start here

1. `superpowers/specs/2026-10-27-postit-design.md` — what we build and why, every decision, money questions for the owner.
2. `superpowers/plans/2026-10-27-postit-implementation-plan.md` — 37 tasks, phases 0 to 5 plus a deferred Phase D (deployment), interfaces, tests, time estimate, owner track.
3. `ops/keys-registry.md` — every key and secret the project needs, where it comes from, and whether we have it.
4. `VERIFICATIONS.md` — platform approval tracker. Meta Business Verification is in progress; everything else is not started; Bluesky needs nothing.

## Integrations (official documentation digests, read 2026-10-27)

One file per platform, same 10 sections: overview, app setup, OAuth, publishing endpoints, rate limits, webhooks, app review, costs, gotchas, sources.

- `integrations/tiktok.md`
- `integrations/instagram.md`
- `integrations/facebook.md`
- `integrations/x.md`
- `integrations/linkedin.md`
- `integrations/youtube.md`
- `integrations/pinterest.md`
- `integrations/threads.md`
- `integrations/bluesky.md`

## Research

- `research/stack.md` — stack research (Vercel findings kept for the record; AWS chosen on 2026-10-27, see the note at the top), Supabase, Polar.sh, costs at 0, 10k and 100k posts.
- `research/claude-code-practices.md` — hooks, agents, `/goal`, loops, permissions, and the harness kit for this project.

## Rules for these docs

- Update the integration doc when a fact is verified or a platform changes something. Add the date.
- Update `VERIFICATIONS.md` status board and log whenever an application is sent or answered.
- Code must cite the doc line for every platform limit it enforces.
