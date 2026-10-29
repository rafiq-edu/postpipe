# Threads API integration notes

Read on 2026-10-27. Base doc root: https://developers.facebook.com/documentation/threads (older path /docs/threads also works).
Short names: [POSTS] = .../docs/threads/posts, [OAUTH] = .../get-started/get-access-tokens-and-permissions, [LONG] = .../get-started/long-lived-tokens, [PUB] = .../documentation/threads/reference/publishing.md, [OVER] = .../docs/threads/overview, [CL] = .../docs/threads/changelog, [TS] = .../docs/threads/troubleshooting, [WH] = .../docs/threads/webhooks. Full URLs are in section 10.

## 1. Overview

What we can publish through the Threads API ([POSTS], [PUB]):
- Text post (`TEXT`), single image (`IMAGE`), single video (`VIDEO`), carousel (`CAROUSEL`, 2 to 20 items, images and videos mixed).
- Link attachment (text-only posts). The first URL in `text` also becomes the link preview. [POSTS]
- Reply control (`reply_control`) and reply approvals (`enable_reply_approvals`). [PUB]
- Quote posts (`quote_post_id`), reposts (`POST /{media-id}/repost`), replies (`reply_to_id`). [PUB]
- Polls: 2 to 4 options, 1 to 25 characters each, text-only posts. https://developers.facebook.com/documentation/threads/create-posts/polls.md
- Topic tag (one per post), location tag (`location_id`), alt text (images and videos), GIFs (GIPHY only, text-only posts). [POSTS], [PUB]
- Also in the API: spoilers, ghost posts, text attachments (up to 10,000 characters, text-only), share to Instagram Stories, geo-gating (`allowlisted_country_codes`). [PUB], [CL]
- Delete posts (since 2025-03-06). [CL]

Account requirements:
- The user needs a Threads profile. A linked Instagram account is not needed since 2025-09-23 (but no `followers_count` or `follower_demographics` insights then). [CL]
- Meta says `threads_content_publish` is for business apps. Consumer-app use is "strictly prohibited". Source: https://developers.facebook.com/documentation/development/permissions (via search summary; read the page again before App Review).

NOT possible / not documented:
- Native scheduled publishing: no parameter and no changelog entry found. Answer: NO. We must schedule in our own queue. [OVER] even says "your app should enforce this limit itself, especially for scheduled posts".
- Showing posts created through the API to other users inside our app: docs say display "only to the user who created them". [OVER]
- Polls or GIFs on image/video posts: UNVERIFIED for GIF on media posts; polls are text-only per the polls page.

## 2. App setup

- Create a Meta app and pick the use case "Access the Threads API". https://developers.facebook.com/documentation/threads/get-started/create-an-app.md
- Required permission `threads_basic` cannot be removed. Others are optional. Same page.
- App type: not stated on the pages read. UNVERIFIED (probably "Business", confirm in the dashboard).
- The app has two IDs and two secrets (Facebook app and Threads app). Use the Threads ID and secret for the Threads API. [GET-STARTED] (see 10)
- Redirect URIs: App Dashboard, Threads use case, Settings, "Client OAuth Settings" (valid OAuth redirect URIs). Must match the request exactly. The dashboard may add a trailing slash. [OAUTH]
- Also in Settings: Deauthorize callback URL, Data deletion (Data Protection Requests) URL. A privacy policy URL and a data deletion method are required to publish. App icon 512x512 to 1024x1024, under 5 MB. create-an-app.md
- EU business: data protection officer contact. create-an-app.md
- Testers: App Dashboard, App roles, Roles, Add People, choose "Threads Tester". The user accepts under Threads Account Settings, "Website permissions". [GET-STARTED]
- App modes: docs only say development vs published. Non-tester users can grant permissions only when the permission is approved in App Review and the app is published. [GET-STARTED]
- Webhooks need the sub-use case "Get real-time notifications with Threads Webhooks". [WH]

## 3. OAuth

Authorize URL (documented): `https://threads.com/oauth/authorize` with `client_id`, `redirect_uri`, `scope` (comma-separated), `response_type=code`, optional `state`. [OAUTH]
- `threads.net/oauth/authorize` is not shown in the page I read. UNVERIFIED. The API host works on both `graph.threads.com` and `graph.threads.net` (since 2025-06-06). [CL]

Code exchange: `POST https://graph.threads.com/oauth/access_token` (form body). [OAUTH]
- `client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`.
- Response: `access_token`, `token_type`, `user_id`.
- The code is valid 1 hour and single use. Remove the `#_` suffix from the code. [OAUTH]

Scopes (create-an-app.md, [GET-STARTED], webhooks page):
- `threads_basic` (all endpoints, required)
- `threads_content_publish` (publishing)
- `threads_manage_replies` (POST reply endpoints), `threads_read_replies` (GET reply endpoints)
- `threads_manage_insights`, `threads_delete`, `threads_keyword_search`, `threads_location_tagging`, `threads_profile_discovery`
- `threads_manage_mentions` (mentions webhook), `threads_share_to_instagram` (Stories cross-share, [CL] 2026-03-25)

Short to long-lived [LONG]:
- `GET https://graph.threads.com/access_token?grant_type=th_exchange_token&client_secret=<SECRET>&access_token=<SHORT>`
- Response: `access_token`, `token_type`, `expires_in` (about 5,183,944 s, 60 days).
- Short-lived token lives 1 hour. An expired one cannot be exchanged.
- Server side only. Never expose the app secret.

Refresh [LONG]:
- `GET https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token&access_token=<LONG>`
- Token must be at least 24 hours old, not expired, and `threads_basic` granted. New token lasts 60 days.
- If not refreshed in 60 days it expires and cannot be refreshed. The user must log in again.
- Permission grants: public profiles 90 days, extended by each refresh. Private profiles: grant cannot be extended, user must grant again. [GET-STARTED]
- Debug a token: `/debug_token`; accepts app access token since 2026-08-18. [CL]

## 4. Publishing endpoints

Host: `https://graph.threads.com/v1.0/` (or graph.threads.net). [POSTS]

Step 1, create container: `POST /{threads-user-id}/threads` [PUB]
- `media_type`: TEXT, IMAGE, VIDEO, CAROUSEL (required).
- `text` (required for TEXT), `image_url`, `video_url` (public URLs).
- `is_carousel_item=true` for items. `children` = comma-separated item container IDs for CAROUSEL.
- `reply_control`: everyone, accounts_you_follow, mentioned_only, parent_post_author_only, followers_only. `enable_reply_approvals` (bool, not on ghost posts).
- `link_attachment` (text-only), `alt_text` (max 1,000 chars per [PUB]; the accessibility page states no limit), `topic_tag` (1 to 50 chars, no periods or ampersands), `location_id` (from `GET /location_search`).
- `poll_attachment` JSON: `{"option_a":"..","option_b":".."}` plus optional `option_c`, `option_d`. Poll duration cannot be set in docs. polls.md
- `quote_post_id`, `reply_to_id`, `gif_attachment` `{gif_id, provider}`, `auto_publish_text` (bool, publishes TEXT posts at creation, skips step 3), `is_spoiler_media`, `is_ghost_post`, `allowlisted_country_codes`, `crossreshare_to_ig`.
- Response: `{"id":"<container-id>"}`.

Step 2, check status: `GET /{container-id}?fields=status,error_message` [TS]
- `IN_PROGRESS`, `FINISHED`, `PUBLISHED`, `ERROR`, `EXPIRED` (not published within 24 hours).
- `error_message` values include FAILED_DOWNLOADING_VIDEO, FAILED_PROCESSING_VIDEO, FAILED_PROCESSING_AUDIO, INVALID_ASPEC_RATIO (sic), INVALID_BIT_RATE, INVALID_DURATION, INVALID_FRAME_RATE, UNKNOWN.
- Docs advise polling once a minute, at most 5 minutes. [TS]

Step 3, publish: `POST /{threads-user-id}/threads_publish` with `creation_id`. [PUB]
- Wait about 30 seconds on average between create and publish. [POSTS]
- Carousel: create each item, create CAROUSEL container with `children`, publish the carousel container. [POSTS]

Example from [PUB]:
```
curl -X POST "https://graph.threads.net/v1.0/{threads-user-id}/threads" \
  -d "media_type=TEXT" -d "text=Hello Threads" -d "reply_control=everyone" -d "access_token={token}"
```

Limits [POSTS]:
- Text: 500 characters. Emoji count by UTF-8 bytes.
- Links: at most 5 unique links. Since 2025-12-22, more fails with `THREADS_API__LINK_LIMIT_EXCEEDED`.
- Image: JPEG or PNG, 8 MB, aspect ratio up to 10:1, width 320 to 1440 px, sRGB.
- Video: MOV or MP4, HEVC or H.264, AAC audio, 23 to 60 FPS, max width 1920 px, up to 300 s, 1 GB, 9:16 recommended, aspect 0.01:1 to 10:1, moov atom at front.
- Carousel: 2 to 20 items.
- Container expiry: 24 hours. [TS]
- Idempotency: no idempotency key found in the docs. UNVERIFIED. We must track our own state to avoid double publish.
- Permalink: after publish, `GET /{media-id}?fields=permalink`. https://developers.facebook.com/documentation/threads/reference/media-retrieval.md (the publish response field list is not documented; assume `{"id": media-id}`, UNVERIFIED).
- Native scheduling: none documented. UNVERIFIED beyond "no changelog entry".

## 5. Rate limits & quotas

From [OVER]:
- Posts: 250 API-published posts per profile per rolling 24 hours. A carousel counts as one.
- Replies: 1,000 per 24 hours. Deletions: 100. Location searches: 500.
- Check usage: `GET /{threads-user-id}/threads_publishing_limit` with fields `quota_usage`, `config`, `reply_quota_usage`, `reply_config`, `delete_quota_usage`, `delete_config`, `location_search_quota_usage`, `location_search_config` (each config has `quota_total`, `quota_duration`).
- Call count: 4800 x impressions per 24 hours, per app and app-user pair (minimum 10 impressions). CPU time: 720,000 x impressions; total time: 2,880,000 x impressions.
- Is the 250 limit per account across all apps? Docs say "per profile". Across apps: UNVERIFIED.

## 6. Webhooks/events

Source [WH]:
- Fields: `replies` (needs threads_basic, threads_read_replies), `delete` (threads_delete), `mentions` (threads_manage_mentions), `publish` (threads_basic; includes replies).
- Setup: add sub-use case "Get real-time notifications with Threads Webhooks", build endpoint, pick topic, "Subscribe to this object", set callback URL and verify token.
- Requirements listed: non-tech provider apps in Live Mode; tech providers at Advanced Access; connected business verified; `replies` and `mentions` not for private accounts.
- Verification handshake details are not on the page (see general Meta webhooks guide). UNVERIFIED.
- Publish webhooks added 2025-08-15, delete 2025-08-01, mentions 2025-07-15. [CL]
- Deauthorize and data deletion callbacks: set in App Settings, Meta pings the URL. create-an-app.md. Payload format (signed_request): UNVERIFIED on Threads pages.

## 7. App review / verification

- Without Advanced Access you can post only for Threads testers. Others need each permission approved in App Review and the app published. [POSTS], [GET-STARTED]
- Standard vs Advanced names are not used on Threads pages. Practical split: tester = works now; non-tester = needs App Review.
- App Review for `threads_content_publish`: use case text, screencast of Threads OAuth login, account linking, creating and publishing a post, viewing it in the Threads app. Depends on `threads_basic`. (permissions reference, via search summary; confirm.)
- Business Verification: Meta's permissions reference says it is required for Advanced Access (search summary). The webhooks page says the connected business must be verified. Webhooks need no App Review. create-an-app.md
- Tech Provider "access verification" page now says it is "no longer required" (retirement post dated 2026/10/09). https://developers.facebook.com/documentation/development/release/access-verification.md
- Timeline: access verification decision about 5 days after the form. App Review time: UNVERIFIED. Forum reports of long delays are not official.
- Current status for us: NOT STARTED (Meta business verification is in progress for the same business).

## 8. Costs

- The docs list no fee for the Threads API. Free. No pricing page found. UNVERIFIED as an explicit statement.

## 9. Gotchas

- Media must be on a public URL at the moment of the attempt. [GET-STARTED] Presign our storage links with enough lifetime.
- 500 chars on `text`. Long text needs `text_attachment` (10,000 chars, text-only, no polls).
- `link_attachment`, poll, GIF and text attachment: text-only posts. `alt_text`: images and videos only.
- 5 unique links max per post, enforced at container creation.
- Containers expire after 24 hours. Do not create early. Wait about 30 s, poll status, then publish.
- Rate limits are per profile and rolling 24 hours. Check `threads_publishing_limit` before queueing.
- Threads token is separate from the Instagram token. Different app ID and secret. [GET-STARTED]
- Long-lived token: refresh before day 60 and only after 24 hours old. Private profiles lose the grant after 90 days.
- Domains moved to threads.com / graph.threads.com. Both .net and .com hosts work for the API. [CL]
- Recent changes: polls 2025-04-14, topic tags 2025-07-14, spoilers and text attachments 2025-10-03, GIPHY GIFs 2026-02-27 (Tenor sunset by 2026-03-31), reply approvals 2026-02-13, link limit 2025-12-22. [CL]
- No native scheduling in docs. Build our own scheduler.

## 10. Sources (all: Read on 2026-10-27)

- https://developers.facebook.com/docs/threads/posts [POSTS]
- https://developers.facebook.com/documentation/threads/reference/publishing.md [PUB]
- https://developers.facebook.com/docs/threads/overview [OVER]
- https://developers.facebook.com/docs/threads/get-started [GET-STARTED]
- https://developers.facebook.com/documentation/threads/get-started/create-an-app.md
- https://developers.facebook.com/docs/threads/get-started/get-access-tokens-and-permissions [OAUTH]
- https://developers.facebook.com/docs/threads/get-started/long-lived-tokens [LONG]
- https://developers.facebook.com/docs/threads/troubleshooting [TS]
- https://developers.facebook.com/docs/threads/changelog [CL]
- https://developers.facebook.com/docs/threads/webhooks [WH]
- https://developers.facebook.com/documentation/threads/reference/media-retrieval.md
- https://developers.facebook.com/documentation/threads/create-posts/polls.md
- https://developers.facebook.com/documentation/threads/create-posts/text-attachments.md
- https://developers.facebook.com/documentation/threads/posts/accessibility.md
- https://developers.facebook.com/documentation/threads/reply-management.md
- https://developers.facebook.com/documentation/threads/posts/quote-posts.md
- https://developers.facebook.com/documentation/threads/llms.txt
- https://developers.facebook.com/documentation/development/release/access-verification.md
- https://developers.facebook.com/documentation/development/permissions (seen only via search summary)
- Not readable: .../docs/threads/overview/permissions (404). Not fetched: rate-limiting, insights, carousel-posts, reference/media pages.
