# Instagram integration (content publishing)

Researched 2026-10-27 from official Meta docs only. Short ids used in citations: see Sources (S1, S2, ...).
"UNVERIFIED" means the fact is not in the official pages we read.
Note: Meta is moving docs from `/docs/instagram-platform/` to `/documentation/instagram-platform/`. Both hosts work.

## Overview

### Login paths (S3, S4, S5)
Meta now lists three ways to log in:

| | Instagram Login | Facebook Login | Unified Login |
|---|---|---|---|
| Meta's label | "For existing integrations" | "For existing Page-linked integrations" | "Recommended for new integrations" |
| User signs in with | Instagram | Facebook | Instagram or Facebook |
| Facebook Page needed | No | Yes | No |
| Business portfolio | Not required by login flow | Depends | Required |
| API host | graph.instagram.com | graph.facebook.com | graph.facebook.com |
| Token | Instagram User token | Facebook User or Page token | Business Integration System User token |

Source for the table: S5 (overview).

Which to choose for Postit:
- Recommendation: Instagram Login. No Facebook Page needed, so fewer user steps. Permalink, publish, status all work. (Our judgment, not Meta text.)
- Cost of this choice: Instagram Login does not support product tagging, partnership ads, or hashtag search (S5). Resumable upload (rupload) is only for Facebook Login for Business (S2).
- Meta calls Unified Login "recommended for new integrations" (S5). UNVERIFIED: what exact setup steps Unified Login needs. Check before we commit. Needs a decision from the founder.
- Decision 2026-10-29: Instagram Login; Unified Login check deferred, needs a live app. Facebook Login is not built.

### What we can publish (S2, S6)
- Single image (JPEG only), single video, Reels, Stories, carousel (up to 20 items, images and videos mixed).
- Caption, user tags, location_id, alt_text (images only, up to 1000 chars), collaborators (up to 3 usernames; feed images, Reels, carousels; not Stories).
- Reels: cover_url (public image), thumb_offset (milliseconds, default 0), share_to_feed, audio_name, trial reels (`trial_params.graduation_strategy` = MANUAL or SS_PERFORMANCE).
- Product tags (max 5): need an approved Instagram Shop, extra permissions `catalog_management` and `instagram_shopping_tag_products` (S7). Not on Instagram Login (S5).
- AI label: `is_ai_generated=true`. On carousels set it on the carousel container only (S2).
- Paid partnership label: Facebook Login only, max 2 sponsor IDs (S2).
- Reels cannot go inside a carousel (S6).

### Account types
- Instagram professional accounts only: Business or Creator (S5).
- Personal (consumer) accounts: NOT supported (S10).
- Stories: Meta says content publishing is "available to all Instagram Professional accounts, except Stories, which are limited to business accounts" (S10). So Creator accounts may not publish Stories. This is on the Facebook Login page. Test with a Creator account on Instagram Login. UNVERIFIED for Instagram Login.

### Not possible
- Personal accounts (S10).
- Filters and shopping tags in the container flow (S2: "Shopping tags are not supported. Filters are not supported").
- Native scheduling. No schedule parameter exists in the docs (S2, S6). We must schedule in our own queue. The 24h quota note in S2 also says apps should enforce limits "especially for scheduled posts".
- Story link, poll, location stickers (S6).
- Reading, updating, deleting through media_publish (S7).

## App setup

- App type must be Business (S8). Create a new app if the current one is not Business.
- Menu path: App Dashboard > Instagram > API setup with Instagram business login (S8). From there you get the embed URL and can generate a token for an account you own.
- Redirect URI: add it in the dashboard Business login settings. It must match exactly, including trailing slash (S9).
- Webhooks server is a prerequisite (S2, S8).
- Privacy policy URL and Terms URL: required for going live. UNVERIFIED in the pages we read (App Review page does not list them, S12).
- Data deletion: apps that access user data must let users request deletion, and the privacy policy must explain how. The callback is optional, but you must give either a callback URL or an instruction URL in Basic Settings (S13). Details in Webhooks section.
- Test users and Instagram testers: how to add them is UNVERIFIED (page not covered in S8). People with a role on the app can use unapproved permissions (S12).
- Development vs live mode: UNVERIFIED in our pages. What is verified: unapproved permissions work only for users with a role on the app (S12). Standard Access is the default for all apps (S5).

## OAuth

### Business Login for Instagram (S9)
1. Send user to `https://www.instagram.com/oauth/authorize` with `client_id`, `redirect_uri`, `response_type=code`, `scope` (comma list), optional `state`, `enable_fb_login` (default true), `force_reauth`.
2. User approves. Meta redirects to `redirect_uri?code=...#_`. Remove the trailing `#_`. The code expires after 1 hour and works once.
3. Server POSTs to `https://api.instagram.com/oauth/access_token` with `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`.
4. Response holds short-lived `access_token`, `user_id`, `permissions` (S9 shows a `data` array wrapper).
5. Server GETs `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=...&access_token=<short>` for a long-lived token. Server side only.
6. User cancel returns `error=access_denied`, `error_reason=user_denied`.

Scopes (S9): `instagram_business_basic`, `instagram_business_content_publish`, `instagram_business_manage_comments`, `instagram_business_manage_messages`. Old `business_*` scopes were deprecated 2025-01-27.
For publishing only we need `instagram_business_basic` and `instagram_business_content_publish` (S2). Ask for comments/messages only when we build those features.

Tokens (S9):
- Short-lived: 1 hour (S5, S8).
- Long-lived: 60 days. Example `expires_in` 5183944 seconds.
- Refresh: `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=<long>`.
- Refresh rules: token at least 24 hours old, not expired, user granted `instagram_business_basic`. A token not refreshed in 60 days expires for good. User must log in again.
- Plan: a daily job refreshes tokens older than, say, 30 days. (Our design.)

### Facebook Login path (S2, S5, S10)
- Publishing permissions: `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` (S2). Add `ads_management` or `ads_read` if the user got the Page role through Business Manager (S2).
- `pages_show_list` appears as a webhook-field permission (S11). `business_management`: UNVERIFIED in the pages we read.
- User needs a Page task of MANAGE or CREATE_CONTENT (S7).
- Token lifetime: short-lived 1 hour, long-lived 60 days, refreshable (S5). Page token "never expires" claim: UNVERIFIED.
- Page Publishing Authorization (PPA) and two-factor rules can block publishing (S2, S7).

## Publishing endpoints

Host: `graph.instagram.com` (Instagram Login) or `graph.facebook.com` (Facebook Login). Current Graph version is v26.0 (S15).

### Container flow (S2, S6, S7)
1. `POST /{ig-user-id}/media` with `image_url` or `video_url`, `caption`, optional `media_type`. Returns `{"id": "<container-id>"}`.
   - Video: `media_type=VIDEO`, `REELS`, or `STORIES` (S2).
   - Story image: `media_type=STORIES` with `image_url`.
   - Carousel: create each child with `is_carousel_item=true`. Then create the carousel container with `media_type=CAROUSEL` and `children=<id1,id2,...>`.
2. `GET /{container-id}?fields=status_code`. Values: `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`, `PUBLISHED`. Poll once per minute, at most 5 minutes (S2).
3. `POST /{ig-user-id}/media_publish?creation_id={container-id}`. Returns `{"id": "<media-id>"}`.
4. Partial success is possible: media is published but caption or user tags were dropped. Fields `config_issue` = `CAPTION_NOT_ATTACHED` or `USER_TAGGING_FAILURE`. Meta says reconcile, do not treat as error (S7).

Lists and objects (`user_tags`, `children`) must be URL-encoded (S2). URLs must be US-ASCII (S6).

### Permalink after publish
- `GET /{media-id}?fields=permalink` (S14). Example form: `https://graph.instagram.com/v26.0/<IG_MEDIA_ID>?fields=id,media_type,media_url,owner,timestamp`.
- Permalink does not work for photos inside albums (children) (S14).
- media_publish itself returns only the id (S7).
- `media_product_type` (FEED, STORY, REELS, AD) is documented only for Facebook Login in S14. A published Reel returns `media_type=VIDEO` (S2).

### Media requirements (S6)
- URL must be public when we publish. Meta fetches it with cURL (S2).
- Image: JPEG only, max 8 MB, aspect ratio 4:5 to 1.91:1, width 320 to 1440 px (outside is scaled), sRGB.
- Story image: JPEG, max 8 MB, 9:16 recommended.
- Reels: MP4 or MOV, no edit lists, moov atom at front. HEVC or H.264, progressive, closed GOP, 4:2:0. 23 to 60 FPS. Max width 1920. Ratio 0.01:1 to 10:1 (9:16 recommended). Video bitrate VBR max 25 Mbps. Audio AAC max 48 kHz, 128 kbps. Duration 3 s to 15 min. File size max 300 MB.
- Reel cover: JPEG max 8 MB, 9:16 recommended.
- Story video: same codecs. Duration 3 to 60 s. Max 100 MB. Ratio 0.1:1 to 10:1.
- Note: our brief said 1 GB for Reels. The reference says 300 MB (S6). Use 300 MB. A 1 GB limit may apply to resumable upload: UNVERIFIED.
- Resumable upload: `POST https://rupload.facebook.com/ig-api-upload/<container-id>`, Facebook Login only (S2).

### Text limits (S6)
- Caption max 2200 characters, 30 hashtags, 20 @ tags. Mentioned users get notified on publish.
- Caption, location_id not supported on carousel children (S6).
- Alt text max 1000 chars. User tags: x,y between 0.0 and 1.0.

### Carousel (S2, S6)
- Up to 20 images and/or videos. All images cropped to first item's ratio (default 1:1).

### Container rules
- Container expires after 24 hours if not published (S2, S6).
- An account can create 400 containers per rolling 24 hours (S6).
- Native scheduling: no (see Overview).

## Rate limits & quotas

- Publishing limit: Meta's docs conflict (S2, S7, S10, S16).
  - 100 API-published posts per 24-hour moving window: Content Publishing guide (S2) and Instagram Login publishing guide (S10).
  - 50 posts per 24 hours: same guide's carousel section (S2), media_publish reference (S7), and content_publishing_limit reference (S16, "currently 50", example returns `quota_total: 50`).
  - Our rule: plan for 50, read the real number from the endpoint per account, never hardcode.
- Carousels count as one post (S2). Whether Stories and Reels count: S16 says it counts "how many times the app user has published an IG Container", so assume yes. Exact rule UNVERIFIED.
- Limit is enforced at `media_publish` (S2).
- Endpoint: `GET /{ig-user-id}/content_publishing_limit?fields=quota_usage,config&since=<unix time within 24h>` (S16). Response: `{"data":[{"quota_usage":2,"config":{"quota_total":50,"quota_duration":86400}}]}`.
- Container creation cap: 400 per rolling 24 hours (S6).
- Graph BUC limit for Instagram: calls in 24 h = 4800 x number of impressions (S17). Impressions = times the account's content appeared on screen in the last 24 h. Business Discovery and Hashtag Search use Platform limits instead.
- Platform limit: app calls per rolling hour = 200 x number of users (S17).
- Headers: `X-Business-Use-Case-Usage` (has `estimated_time_to_regain_access` in minutes), `X-App-Usage` (S17).
- Error codes (S17): 4 (app limit), 17 (user limit), 32 (Pages API limit), 613 (custom limit), 80002 (Instagram BUC limit).
- Publish-quota error code: UNVERIFIED in official docs (see Gotchas).

## Webhooks/events

- Instagram Login fields (S11): `comments`, `live_comments`, `message_echoes`, `message_reactions`, `messages`, `messaging_handover`, `messaging_optins`, `messaging_postbacks`, `messaging_referral`, `messaging_seen`, `standby`. Mentions come inside the `comments` notification.
- `story_insights`: NOT available on Instagram Login. Available on Facebook Login and Unified Login with `instagram_manage_insights` (S11).
- Facebook Login fields: `comments`, `live_comments`, `mentions`, `story_insights`. No messaging fields (S11).
- Permissions for Instagram Login `comments`: `instagram_business_basic` + `instagram_business_manage_comments` (S11).
- None of these fields report publish success. We poll `status_code` instead. (UNVERIFIED that no publish webhook exists; none is listed in S11.)

Setup (S18):
1. HTTPS endpoint with valid TLS. Self-signed not supported. Must answer GET (verify) and POST (events).
2. In App Dashboard add callback URL + verify token, verify, pick fields.
3. Subscribe each account: `POST https://graph.instagram.com/v26.0/<IG_ACCOUNT_ID>/subscribed_apps` with `subscribed_fields=...` and the user's token. Returns `{"success": true}`. Facebook Login uses `/<PAGE_ID>/subscribed_apps` with a Page token.
4. You cannot pick fields per account.

Verification (S18): Meta sends GET with `hub.mode=subscribe`, `hub.challenge`, `hub.verify_token`. Check the token. Return `hub.challenge`.
Signature (S18): header `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256 of body with app secret.
Delivery (S18): reply `200 OK`. Batches up to 1000 updates. Failed deliveries retry up to 36 hours, so de-duplicate.
Limits (S18): `comments` and `live_comments` need Advanced Access. Private accounts get no comment/mention notifications.

Deletion (S13): optional Data Deletion Request URL (HTTPS). Meta POSTs a `signed_request` (HMAC-SHA256 with app secret; contains `user_id`). Reply JSON `{ url, confirmation_code }`. Start deleting that user's Meta-sourced data.
Deauthorize callback: not described in the pages we read. UNVERIFIED.

## App review / verification

Current status for us: IN PROGRESS. The founder is working on Meta business verification.

- Standard Access: default. For people with a role on the app, dev and testing only (S5).
- Advanced Access: needed to serve accounts we do not own or manage, or users without a role. Needs App Review and Business Verification (S5, S9).
- App Review is required when anyone without a role on the app uses it (S12). Meta tests each permission. If Meta cannot access the app, the whole submission is rejected (S12).
- Permissions we must request for publishing: `instagram_business_basic`, `instagram_business_content_publish`. Advanced Access needed for both for public users (S9, S10). Exact per-permission review rules: UNVERIFIED beyond this.
- Business Verification (S19): required when the app asks for advanced access to permissions or lets other businesses use it. Steps: App Dashboard > Settings > Basic > Verification, connect or create a Business, then an Admin of that Business completes verification in Business Manager.
- Documents accepted: not listed in S19. It points to the Business Manager Help Center. UNVERIFIED.
- Screencast requirements, privacy-policy rules, Data Use Checkup: UNVERIFIED (S12 does not list them).
- Testing before approval: users with a role on the app can use unapproved permissions (S12). Instagram tester role steps: UNVERIFIED.
- Timeline: UNVERIFIED (not stated in S12 or S19).
- Tech Provider verification: not covered in S19. UNVERIFIED if needed for us.

## Costs

- No fees are mentioned in any page we read. Expected free. Official statement of "free": UNVERIFIED.
- Paid programs: none found in the Instagram Platform docs we read. UNVERIFIED.

## Gotchas

- Public URL: Meta must fetch the media when we publish. We must serve files from our own storage with a public, stable URL. Signed URLs must stay valid through processing (S2).
- Non-US-ASCII URLs fail (S6).
- JPEG only. MPO and JPS fail. Convert PNG/WebP/HEIC before upload (S2).
- Video is processed asynchronously. Poll `status_code` once a minute for up to 5 minutes (S2). Longer videos may need more time: UNVERIFIED.
- `EXPIRED` container: not published within 24 hours. Create a new container (S2).
- Reels and Stories return `media_type=VIDEO` or `IMAGE/VIDEO` after publish. Use `media_product_type` (S2, but S14 says Facebook Login only).
- Partial success on media_publish: check `config_issue` (S7).
- Upload failure example: `ProcessingFailedError`, `retriable:false` (S10).
- Quota conflict 50 vs 100: read `content_publishing_limit` (S2, S16).
- Quota error code 9 / subcode 2207042: found only in a third-party summary, not official. UNVERIFIED. Do not rely on it.
- Image-specific error subcodes: UNVERIFIED. Meta only links to an Error Codes page (S6).
- PPA and two-factor on the linked Page can block Facebook Login users (S2, S7).
- Graph API versions (S15): v20.0 ends 2026-09-24 (already past). v21.0 ends 2027-01-21. v22.0 ends 2027-05-20. v23.0 ends 2027-10-08. v24.0 ends 2028-02-18. v25.0 ends 2028-07-29. v26.0 introduced 2026-07-29. Pin a version and track these dates. Instagram v1.0 API deprecated (S20).
- Changes (S20): alt_text added 2025-03-24. Trial Reels `trial_params` 2025-12-03. Delete Media endpoint 2025-12-03 (needs `instagram_manage_contents`). Paid partnership label at publish 2026-04-22. Audio API for Reels 2026-06-01. `is_ai_generated` 2026-06-22. `enable_fb_login` login option 2026-02-06. `force_reauth` 2025-06-14. oEmbed without token 2026-05-15. Legacy `business_*` scopes dead since 2025-01-27 (S9).
- Date of the 50 to 100 limit change: no official changelog entry found. UNVERIFIED.
- Feature gaps on Instagram Login: no product tagging, no partnership ads, no hashtag search, no story_insights webhook, no resumable upload (S2, S5, S11).
- Instagram Login publishing needs no Page. Facebook Login does (S5).

## Sources

All read on 2026-10-27.

- S1 https://developers.facebook.com/docs/instagram-platform (index; content came via S2 to S5)
- S2 https://developers.facebook.com/docs/instagram-platform/content-publishing - Read on 2026-10-27
- S3 https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login - Read on 2026-10-27
- S4 https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login - Read on 2026-10-27
- S5 https://developers.facebook.com/documentation/instagram-platform/overview - Read on 2026-10-27
- S6 https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media - Read on 2026-10-27
- S7 https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media_publish - Read on 2026-10-27
- S8 https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/get-started - Read on 2026-10-27
- S9 https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login - Read on 2026-10-27
- S10 https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing - Read on 2026-10-27
- S11 https://developers.facebook.com/documentation/instagram-platform/webhooks/fields - Read on 2026-10-27
- S12 https://developers.facebook.com/docs/resp-plat-initiatives/individual-processes/app-review - Read on 2026-10-27
- S13 https://developers.facebook.com/docs/development/create-an-app/app-dashboard/data-deletion-callback - Read on 2026-10-27
- S14 https://developers.facebook.com/docs/instagram-platform/reference/instagram-media - Read on 2026-10-27
- S15 https://developers.facebook.com/docs/graph-api/changelog - Read on 2026-10-27
- S16 https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit - Read on 2026-10-27
- S17 https://developers.facebook.com/docs/graph-api/overview/rate-limiting - Read on 2026-10-27
- S18 https://developers.facebook.com/documentation/instagram-platform/webhooks/setup (and https://developers.facebook.com/docs/instagram-platform/webhooks) - Read on 2026-10-27
- S19 https://developers.facebook.com/docs/development/release/business-verification - Read on 2026-10-27
- S20 https://developers.facebook.com/documentation/instagram-platform/changelog - Read on 2026-10-27
