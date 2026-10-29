# Bluesky (AT Protocol) integration

Researched 2026-10-27. Status for Postit: NOT NEEDED (no app review). Facts marked UNVERIFIED were not found in official docs.

Note on sources: docs.bsky.app now redirects to bsky.network and the rendered pages did not load for our fetch tool. We read the official page sources in github.com/bluesky-social/bsky-docs and the official lexicons (schemas) shipped in the npm package `@atproto/api`, built from github.com/bluesky-social/atproto. Source tags [S1]..[S20] map to the Sources section.

## 1. Overview

What we can publish through `app.bsky.feed.post` records [S3][S9]:
- Text: up to 300 graphemes (user-visible characters), and also max 3000 bytes [S9].
- Up to 4 images, each with alt text [S9][S3].
- 1 video, with alt text and optional captions (max 20 files, text/vtt) [S9].
- External link card (title, description, optional thumbnail blob) [S3][S9].
- Quote post (`app.bsky.embed.record`) and image/video + quote (`recordWithMedia`) [S3][S9].
- Reply threads: a reply needs `root` and `parent` strong refs (uri + cid) [S3].
- Language tags: `langs`, max 3 [S9].
- Self-labels (content warnings) via `labels` [S9].
- Hashtags: via facets; extra `tags` field max 8 [S9]. A facet tag is max 64 graphemes [S9].

NOT possible:
- Native scheduling: no scheduling field in the post record or API [S9]. We must schedule in Postit and call the API at the right time.
- Polls: no poll embed in the post schema [S9].
- Editing: UNVERIFIED in docs. The post schema has no edit field. A record can be rewritten (`putRecord`), but Bluesky shows no edit feature in the docs we read.

Custom PDS hosts: the account lives on a PDS (personal data server). Many users are on bsky.social, but others use their own. We must resolve the PDS from the user's DID and talk to it, not hard-code bsky.social [S2][S5].

## 2. App setup

- No developer portal, no app approval, no API key [S2][S5]. OAuth is open: "without prior registration" [S2].
- OAuth: you host a client metadata JSON document at a public HTTPS URL. That URL is the `client_id`. It must match the URL it is fetched from, return HTTP 200, and not redirect [S2][S20].
- Required fields: `client_id`, `grant_types` (`authorization_code`, `refresh_token`), `scope`, `response_types` (`code`), `redirect_uris`, `dpop_bound_access_tokens: true` [S2].
- Confidential client (our case, a web service): add `token_endpoint_auth_method: private_key_jwt`, `token_endpoint_auth_signing_alg: ES256`, and `jwks` or `jwks_uri` with public keys [S2].
- Scope string: `atproto transition:generic` (see section 3) [S2][S5].
- `client_uri` must have the same hostname as `client_id`. `client_name`, `logo_uri`, `tos_uri`, `policy_uri` are recommended [S2].
- Example metadata (browser app, from docs): scope `"atproto transition:generic"`, `"redirect_uris": ["https://app.example.com/oauth/callback"]` [S2].
- Alternative, app passwords: the user creates one in Bluesky settings (format `xxxx-xxxx-xxxx-xxxx`). We call `com.atproto.server.createSession` with handle + app password [S11][S18].

## 3. OAuth

Flow [S5][S2]:
1. Start from the handle or DID. Verify the handle against the DID document both ways.
2. Resolve the DID document and read the PDS host.
3. Fetch `/.well-known/oauth-protected-resource` on the PDS. It lists the authorization server.
4. Fetch `/.well-known/oauth-authorization-server` for endpoints (PAR, authorize, token).
5. After the token response, check that the `sub` DID matches the server issuer.
6. Cache identity lookups under 10 minutes [S5].

Required security parts [S5][S2]:
- PAR (pushed authorization request): required for all clients.
- PKCE with S256: required. `plain` is not allowed.
- DPoP (proof-of-possession key per session, ES256): required. The server sends a `DPoP-Nonce`. Nonces rotate, max 5 minutes. A new keypair per auth session. Never reuse across users.
- Confidential clients also sign a JWT client assertion (`private_key_jwt`) on PAR and every token request [S2].

Token lifetimes [S5]:
- Access token: under 30 minutes. Max 15 min if the server cannot revoke single tokens. 5 min recommended.
- Public client: session and refresh token each limited to 2 weeks.
- Confidential client: session can be unlimited. Each refresh token max 180 days.
- Refresh tokens are single-use (rotation). Use a lock so two requests do not refresh at once, or the session is lost [S5][S2].

Scopes [S5][S19][S17]:
- `atproto` is required.
- `transition:generic` is about the same as an app password: write records, upload blobs, preferences. No account management, no DMs.
- Granular scopes now exist: `repo:<collection>?action=create`, `blob:<mime>`, `rpc:...`, `include:<permission-set>` [S19]. Bluesky published a narrow set `app.bsky.authCreatePosts` for posting-only apps [S17]. Example string from docs: `atproto repo:com.example.post blob:*/*` [S17]. We did not test these on a live PDS. Check that the target PDS supports them, or fall back to `transition:generic`.

Revocation: the user can view and delete sessions on the authorization server UI [S5]. We must remove a key from our JWKS to kill all sessions of that key [S5]. A token revocation endpoint is NOT defined in the spec page we read [S5].

Limits of OAuth: the docs say OAuth is "not currently recommended" for headless clients like CLI tools or bots [S2]. A web service backend is the supported case.

App-password sessions [S18][S11]:
- `createSession` returns `accessJwt` (short) and `refreshJwt`. Refresh with `com.atproto.server.refreshSession` using the refresh JWT [S18][S11].
- Exact lifetimes: UNVERIFIED (spec only says "short"; it suggests refreshing every couple of minutes) [S18].
- App passwords cannot delete the account or manage app passwords [S18]. User can revoke them at any time [S18].
- `createSession` limit: 30 per 5 min and 300 per day per account [S4].

Recommendation for multi-tenant SaaS: use OAuth as a confidential client with `atproto transition:generic`.
- Users never give us a password. App passwords are asked in plain form and ask users to manage secrets.
- Per-session DPoP keys and rotating refresh tokens are safer to store.
- Confidential clients get up to 180-day refresh tokens, so users re-link rarely [S5].
- Cost: more work (DPoP, PAR, metadata, JWKS, nonce handling, refresh locking). Use the official OAuth client library for Node/TS instead of building it [S2 says SDKs are the usual path].
- Offer app password only as a fallback for users blocked by an odd PDS. UNVERIFIED whether any PDS lacks OAuth.

## 4. Publishing endpoints

Host: send calls to the user's PDS, with DPoP-bound OAuth tokens [S2].

Images [S3][S9][S12]:
- `com.atproto.repo.uploadBlob` with raw bytes and the right Content-Type. Returns a `blob` object. Unreferenced blobs are deleted after a time window (minutes) [S12].
- Image cap: the current lexicon says "up to 2 MB, formerly limited to 1 MB", `maxSize: 2000000`, accept `image/*` [S9]. The tutorial also says 2 MB [S3]. This changes the brief (1,000,000). For safety we still target under 1,000,000 bytes: older PDS or AppViews may still reject. UNVERIFIED which hosts still enforce 1 MB.
- Link card thumbnail blob: `maxSize: 1000000` (1 MB) [S9].
- PDS has its own blob cap: 52,428,800 bytes (50 MB) [S4].
- Strip image metadata before upload [S3].
- Embed shape: `{"$type":"app.bsky.embed.images","images":[{"alt":"...","image":<blob>,"aspectRatio":{"width":W,"height":H}}]}` [S3][S9].

Create the post: `com.atproto.repo.createRecord` [S13]
- Body: `repo` (DID), `collection` = `app.bsky.feed.post`, `record`, optional `rkey` (max 512 chars), `validate`, `swapCommit` [S13].
- Required in record: `text`, `createdAt` (ISO time) [S3][S9]. Response: `uri` (at://...) and `cid` [S3].
- Optional: `facets`, `embed`, `langs`, `reply`, `labels`, `tags` [S9].
- Embed union: images, video, external, record, recordWithMedia (and a newer `gallery`, not in the docs we read) [S9].

Facets (links, mentions, hashtags) [S9][S10]:
- Each facet has `index` {`byteStart`, `byteEnd`} and `features` (mention with DID, link with full URI, tag without the `#`).
- Indexes count UTF-8 BYTES, start inclusive, end exclusive. JavaScript strings are UTF-16, so convert to bytes first [S9].
- Mentions need a DID: resolve the handle to a DID first (`com.atproto.identity.resolveHandle`) [S10]. The text shows `@handle`, the facet holds the DID.

Video [S6][S15][S9]:
- Simple way: `uploadBlob` to the PDS. Problem: processing starts only after the post is posted, so viewers can see a broken video [S6].
- Recommended way [S6]:
  1. `com.atproto.server.getServiceAuth` with `aud = did:web:<PDS host>`, `lxm = com.atproto.repo.uploadBlob`, `exp` about 30 minutes [S6]. (Default exp is only 60 seconds [S14].)
  2. POST bytes to `https://video.bsky.app/xrpc/app.bsky.video.uploadVideo?did=...&name=...` with `Authorization: Bearer <service token>` and `Content-Type: video/mp4`.
  3. Poll `app.bsky.video.getJobStatus` (docs sample polls every second) until `blob` is returned.
  4. Create the post with `app.bsky.embed.video` and that blob plus `aspectRatio`.
- Job states: CREATED, ENCODING, ENCODED, SCANNING, SCANNED, UPLOADING, UPLOADED, COMPLETED, FAILED. Failure codes: validation_failure, encoding_failure, pds_upload_failure, pds_upload_unsupported_blob_size, generic_failure [S9].
- If the same source was processed before, `getJobStatus` errors with `already_exists` and gives the old blob ref [S6].
- Limits: file `video/mp4`, max 300,000,000 bytes (300 MB; formerly 100 MB) [S9]. Duration max 10 minutes in the official app code (`VIDEO_MAX_DURATION_MS`) [S16] and the official account announced it [S7]. Launch limit was 60 s, 25 videos or 10 GB per day [S8]; the current daily limit is UNVERIFIED. Read it per user with `app.bsky.video.getUploadLimits` (`canUpload`, `remainingDailyVideos`, `remainingDailyBytes`) [S9].
- Bluesky-hosted accounts must have a verified email before video upload. Check with `com.atproto.server.getSession` [S6].

Post URL: record `uri` is `at://<did>/app.bsky.feed.post/<rkey>`. Public URL = `https://bsky.app/profile/<handle or did>/post/<rkey>`. The format is used in official docs links (bsky.app/profile/.../post/...) [S1]. Look up the current handle from the DID; a DID in the URL also works. UNVERIFIED in the API docs themselves.

Idempotency: no idempotency key exists. Post records use `key: tid` (timestamp ID) [S9]. You can pass your own `rkey` in createRecord [S13]. A second create with the same rkey fails, so a stable rkey per Postit post protects against double posts on retry. `swapCommit` does compare-and-swap on the repo commit [S13]. It is not needed for plain posting. UNVERIFIED: exact error returned on duplicate rkey.

## 5. Rate limits and quotas [S4]

- Writes per account: 5,000 points/hour and 35,000 points/day. Create = 3, update = 2, delete = 1. So max 1,666 creates/hour and 11,666/day.
- Writes through `applyWrites` are counted per record.
- All PDS API requests: 3,000 per 5 minutes per IP. Many tenants behind one server IP share this budget.
- `createSession`: 30 per 5 min, 300 per day, per account.
- `updateHandle`: 10 per 5 min, 50 per day. `createAccount`: 100 per 5 min per IP.
- Video: daily count and bytes per account; read from `getUploadLimits` [S9]. Launch values 25 videos / 10 GB per day [S8].
- Over a limit: HTTP 429. Many services return rate-limit headers (IETF draft "RateLimit" headers) [S4]. A `Retry-After` header may be present [S18]. Exact header names: UNVERIFIED in Bluesky docs.
- Limits "are likely to evolve" [S4]. Other PDS hosts may use different limits [S4].

## 6. Webhooks and events

No webhooks. The network has a firehose (the relay at bsky.network [S4]) and Jetstream (lighter JSON version). Not needed for posting. Jetstream details: UNVERIFIED here (docs not read). We would only need them for analytics or to confirm a post appeared.

## 7. App review and verification

- No app review, no approval, no registration for OAuth [S2].
- Developer Guidelines apply when you federate and talk to Bluesky services [S15b]:
  - Ban spam, automated or bulk interactions, and follow-for-follow tools.
  - Apps with user content need ways to report and block illegal or abusive content, and to delete content on request.
  - Publish contact info (a monitored email). Keep reasonable security.
  - Breaking rules can lead to suspended access to Bluesky-run services.
- The ToS calls other atproto apps "Developer Applications"; their own terms govern them [S15a]. The Community Guidelines also bar abusing APIs or rate limits [S15c].
- Current status for us: NOT NEEDED.

## 8. Costs

Free. No fees for the API, OAuth, or video service were found in the docs read. Paid-tier info: UNVERIFIED (none seen).

## 9. Gotchas

- 300 graphemes, not characters or bytes. `👨‍👩‍👧‍👧` is 1 grapheme but 25 UTF-16 code units in JS [S3]. Use a grapheme segmenter (`Intl.Segmenter`) and also respect the 3000-byte cap [S9].
- Facet byte math: UTF-8 bytes, not JS string index. Wrong offsets give broken links or mentions [S9].
- Image caps: lexicon says 2 MB now, our brief said 1 MB. We resize to under 1,000,000 bytes to be safe. Thumbnails for link cards: 1 MB [S9].
- Link cards are made by the client. We must fetch the page, make title/description, and upload the thumb as a blob [S3].
- Users on third-party PDSs: resolve per user. Service-auth `aud` for video must be the user's PDS DID [S6].
- OAuth complexity: DPoP nonces, PAR, client metadata, JWKS, refresh locking. Lost refresh = user must re-link [S2].
- App passwords: poor UX, the user can revoke at any time [S18], and they are weaker than OAuth.
- Video: separate service, async jobs, email-verified accounts only for Bluesky-hosted, daily caps [S6][S8].
- DM scope is separate (`transition:chat.bsky`); we do not need it [S5].
- Docs changes 2025-2026: OAuth launched 2024-2025 with transitional scopes; granular scopes and permission sets now documented [S17][S19]; video max 300 MB / 10 min [S9][S16]; verification badges and Trusted Verifiers started 2025-04-21 [S20b]. Verification does not affect the API. The ToS/Privacy update took effect 2025-09-15 [S15a].
- The OAuth spec marks parts as changeable; re-check before launch.

## 10. Sources (Read on 2026-10-27)

- [S1] https://bsky.app/profile/bsky.app/post/3k2ivw5fkam2x (official account post URL pattern). Read on 2026-10-27
- [S2] https://docs.bsky.app/docs/advanced-guides/oauth-client (source: github.com/bluesky-social/bsky-docs/blob/main/docs/advanced-guides/oauth-client.md). Read on 2026-10-27
- [S3] https://docs.bsky.app/docs/tutorials/creating-a-post (source: bsky-docs repo docs/tutorials/creating-a-post.mdx). Read on 2026-10-27
- [S4] https://docs.bsky.app/docs/advanced-guides/rate-limits (source: bsky-docs repo docs/advanced-guides/rate-limits.md). Read on 2026-10-27
- [S5] https://atproto.com/specs/oauth. Read on 2026-10-27
- [S6] https://docs.bsky.app/docs/tutorials/video (source: bsky-docs repo docs/tutorials/video.mdx). Read on 2026-10-27
- [S7] https://bsky.app/profile/bsky.app/post/3mtwf7gxkwc2r (official account, 10-minute video). Seen only as a search summary, not opened. Read on 2026-10-27
- [S8] https://bsky.social/about/blog/09-11-2024-video. Read on 2026-10-27
- [S9] Lexicons in npm `@atproto/api` (app.bsky.feed.post, embed.images/video/external/record, richtext.facet, video.defs, video.getUploadLimits), from https://github.com/bluesky-social/atproto/tree/main/lexicons. Read on 2026-10-27
- [S10] https://docs.bsky.app/docs/advanced-guides/post-richtext (source: bsky-docs repo; fetched, not read in detail). Read on 2026-10-27
- [S11] https://docs.bsky.app/docs/api/com-atproto-server-create-session (lexicon com.atproto.server.createSession / refreshSession). Read on 2026-10-27
- [S12] https://docs.bsky.app/docs/api/com-atproto-repo-upload-blob (lexicon com.atproto.repo.uploadBlob). Read on 2026-10-27
- [S13] https://docs.bsky.app/docs/api/com-atproto-repo-create-record (lexicon com.atproto.repo.createRecord). Read on 2026-10-27
- [S14] lexicon com.atproto.server.getServiceAuth, https://docs.bsky.app/docs/api/com-atproto-server-get-service-auth. Read on 2026-10-27
- [S15a] https://bsky.social/about/support/tos ; [S15b] https://docs.bsky.app/docs/support/developer-guidelines ; [S15c] https://bsky.social/about/support/community-guidelines. Seen as a search summary only. Read on 2026-10-27
- [S16] https://github.com/bluesky-social/social-app/blob/main/src/lib/constants.ts (VIDEO_MAX_DURATION_MS, MAX_GRAPHEME_LENGTH). Read on 2026-10-27
- [S17] https://docs.bsky.app/blog/oauth-improvements and https://atproto.com/guides/permission-sets (search summary only). Read on 2026-10-27
- [S18] https://atproto.com/specs/xrpc. Read on 2026-10-27
- [S19] https://atproto.com/specs/permission. Read on 2026-10-27
- [S20] https://atproto.com/specs/auth (OAuth lifetimes). Read on 2026-10-27
- [S20b] https://bsky.social/about/blog/04-21-2025-verification (search summary only). Read on 2026-10-27
- Not read: https://docs.bsky.app/docs/advanced-guides/api-directory, https://docs.bsky.app/docs/get-started, https://docs.bsky.app/docs/advanced-guides/posts, https://atproto.com/specs/lexicon, https://docs.bsky.app/docs/api/app-bsky-video-upload-video, https://docs.bsky.app/docs/api/app-bsky-video-get-job-status (the lexicons behind them were read through [S9]).
