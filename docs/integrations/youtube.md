# YouTube integration (Postit)

## Overview

What we can do with the YouTube Data API v3:

- Upload a video with title, description, tags and category. [videos](https://developers.google.com/youtube/v3/docs/videos)
- Set privacy to `private`, `unlisted` or `public`. [videos](https://developers.google.com/youtube/v3/docs/videos)
- Schedule a publish time with `status.publishAt`. [videos](https://developers.google.com/youtube/v3/docs/videos)
- Set a custom thumbnail with `thumbnails.set`. [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)
- Post a Short. There is no separate Shorts endpoint. A video is a Short if it is square or vertical and up to 3 minutes long. [Shorts](https://support.google.com/youtube/answer/15424877)
- Add a video to a playlist with `playlistItems.insert` (50 quota units). [quota cost](https://developers.google.com/youtube/v3/determine_quota_cost)

What is NOT possible (UNVERIFIED: no official page says "not possible", we found no API method for these):

- Community posts. We found no method for them in the API reference.
- Editing the video file after upload. `videos.update` changes metadata only. UNVERIFIED.

Channel vs brand account: UNVERIFIED in the pages we read. The upload goes to the channel the user picks at the Google consent screen. Test this with a brand account before launch.

Postit must let the user choose title, description and privacy. [required minimum functionality](https://developers.google.com/youtube/terms/required-minimum-functionality)

## App setup

1. Sign in with a Google account. Create a project in the Google Cloud console. [getting started](https://developers.google.com/youtube/v3/getting-started)
2. Enable YouTube Data API v3 on the Enabled APIs page (API Library). [getting started](https://developers.google.com/youtube/v3/getting-started)
3. Set up the OAuth consent screen. Fields: user type, app name, support email, logo, home page, privacy policy, terms of service, authorized domains, developer contact. Then declare scopes, add test users. [submit for verification](https://support.google.com/cloud/answer/13461325)
4. Create OAuth client credentials of type "web server". [submit for verification](https://support.google.com/cloud/answer/13461325)

Publishing status [publishing status](https://support.google.com/cloud/answer/15549945):

- Testing: max 100 test users. They see an "unverified app" warning. Authorizations and refresh tokens expire after 7 days.
- In production: any Google user can authorize. Verification may still be needed for sensitive scopes.
- Unverified app cap: an app with unapproved sensitive scopes can add only 100 new users in total, for the life of the project. It cannot be reset.

Redirect URIs [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server):

- Must be HTTPS, except localhost.
- No raw IP hosts, no wildcards, no fragments.
- Must match an authorized URI exactly, including trailing slash.

Homepage, privacy policy and branding [verification requirements](https://support.google.com/cloud/answer/13464321):

- Homepage on a domain we own and verify. It must describe the app. It cannot be only a login page. It must link the privacy policy.
- Privacy policy on the same domain. Same link on the homepage and the consent screen. It must say how Google user data is accessed, used, stored and shared.
- Buttons that start Google authorization must follow Google branding guidelines.

YouTube also requires the privacy policy to [developer policies](https://developers.google.com/youtube/terms/developer-policies):

- State that the app uses YouTube API Services.
- Link the Google Privacy Policy.
- Link Google security settings, where users can revoke access.

## OAuth

Flow: authorization code flow for a web server app. [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)

- Authorize endpoint: `https://accounts.google.com/o/oauth2/v2/auth`
- Token endpoint: `https://oauth2.googleapis.com/token`

PKCE: UNVERIFIED. The web server page and the OAuth overview do not mention PKCE. Our server keeps a client secret, so we do not depend on it.

Scopes [scopes](https://developers.google.com/identity/protocols/oauth2/scopes):

| Scope | Google description |
|---|---|
| `https://www.googleapis.com/auth/youtube.upload` | Manage your YouTube videos |
| `https://www.googleapis.com/auth/youtube` | Manage your YouTube account |
| `https://www.googleapis.com/auth/youtube.readonly` | View your YouTube account |
| `https://www.googleapis.com/auth/youtube.force-ssl` | See, edit, and permanently delete your YouTube videos, ratings, comments and captions |

- `videos.insert` accepts `youtube.upload`, `youtube`, `youtubepartner` or `youtube.force-ssl`. [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)
- `thumbnails.set` accepts the same four. [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)
- Ask for the narrowest scope. Request `youtube.upload` for publishing and `youtube.readonly` for channel info and status polling. [verification requirements](https://support.google.com/cloud/answer/13464321)
- The official scopes page we read does not mark which scopes are sensitive. See the verification section.

Tokens:

- Access token lifetime: the docs say only "limited lifetimes". The sample response shows `expires_in` 3920 seconds. The "1 hour" figure is UNVERIFIED. Always read `expires_in`. [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- Refresh token: send `access_type=offline`. A refresh token is returned only on the first authorization. To get a new one, send `prompt=consent` or have the user revoke first. [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)

A refresh token stops working when [OAuth overview](https://developers.google.com/identity/protocols/oauth2):

- The user revokes access.
- It is unused for six months.
- The account reaches the live refresh token limit: 100 per account per OAuth client ID. A new token silently kills the oldest one.
- The project is in Testing with an external user type: tokens last 7 days.
- An admin restricts the service (`admin_policy_enforced`), or a Cloud session policy ends the session (`invalid_grant`).

Revocation: call the revoke endpoint. YouTube policy says revoke the token right away when the user disconnects in our app. [developer policies](https://developers.google.com/youtube/terms/developer-policies)

## Publishing endpoints

Start a resumable session [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol):

```
POST https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
Authorization: Bearer ...
Content-Type: application/json; charset=UTF-8
X-Upload-Content-Length: <file size>
X-Upload-Content-Type: video/*
```

- Body is a `video` resource (snippet and status). Success is `200 OK` with the session URI in the `Location` header.
- Then `PUT` the bytes to the session URI. Final success is `201 Created` with the video resource.
- Only `part` is required on `videos.insert`. [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)

Chunked upload [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol):

- Chunk size must be a multiple of 256 KB. The last chunk is exempt. All other chunks must be the same size.
- Header: `Content-Range: bytes FIRST-LAST/TOTAL`. Example: `bytes 0-524287/2000000`.
- A middle chunk returns `308`. The `Range` header shows the bytes received. The final chunk returns `201`.
- Bytes must be contiguous. Overlap or gaps make none of the content upload.
- The docs' chunk example shows `Content-Length: 524888` for a 524,288 byte chunk. This looks like a typo. Use the real byte count.

Resume after failure [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol):

- Resumable failures: lost connection, `500`, `502`, `503`, `504`. Retry with exponential backoff.
- Ask for status: empty `PUT` to the session URI with `Content-Length: 0` and `Content-Range: bytes */TOTAL`.
- `308` plus `Range: bytes=0-N` means send from byte N+1. No `Range` header means nothing arrived. Honor `Retry-After`.
- `404` means the session expired. Start again from byte 0.
- Other `4xx` are permanent errors.

Limits [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert):

- Max file size 256 GB. MIME types `video/*` and `application/octet-stream`.
- Specific video formats (containers, codecs): UNVERIFIED on the pages we read.

Fields [videos resource](https://developers.google.com/youtube/v3/docs/videos):

- `snippet.title`: required, max 100 characters, no `<` or `>`.
- `snippet.description`: max 5000 BYTES (not characters), no `<` or `>`.
- `snippet.tags[]`: max 500 characters in total. Commas count. A tag with a space counts 2 extra characters (quotes).
- `snippet.categoryId`: from `videoCategories.list`.
- `status.privacyStatus`: `private`, `unlisted`, `public`. If omitted, the video is public. Account settings may force private.
- `status.publishAt`: ISO 8601. Only for a `private` video that was never published. Send `privacyStatus=private` with it. A time in the past publishes at once.
- `status.selfDeclaredMadeForKids`: boolean, set by the channel owner.
- `status.containsSyntheticMedia`: boolean, discloses realistic altered or synthetic content.

Thumbnails: `POST https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=...` [thumbnails.set](https://developers.google.com/youtube/v3/docs/thumbnails/set)

- Formats `image/jpeg`, `image/png`. Max 50 MB (raised from 2 MB on 2026-09-14, [revision history](https://developers.google.com/youtube/v3/revision_history)).
- Custom thumbnails need a verified account. [YouTube help](https://support.google.com/youtube/answer/72431) The API page lists only a `403 forbidden` for "no permission to upload custom thumbnails".
- Error `429 uploadRateLimitExceeded`: too many thumbnails recently.
- Shorts thumbnails can only be added in YouTube Studio on a computer. [YouTube help](https://support.google.com/youtube/answer/72431) So API thumbnails for Shorts: UNVERIFIED, plan to skip them.

Video URL: UNVERIFIED as a documented rule. The `201` response has the video `id`. Build `https://www.youtube.com/watch?v=ID`.

`notifySubscribers`: boolean query param on `videos.insert`, default `True`. [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert)

## Rate limits & quotas

Current rules (changed in 2025-2026, see revision history) [revision history](https://developers.google.com/youtube/v3/revision_history), [quota cost](https://developers.google.com/youtube/v3/determine_quota_cost):

- Default per project per day: 10,000 units for all endpoints except `search.list` and `videos.insert`.
- `videos.insert` and `search.list` each have their own bucket: 100 calls per day by default.
- Granular buckets started 2026-06-01. Before that, uploads cost about 1,600 units.
- `thumbnails.set` 50 units. `playlistItems.insert` 50. `playlists.insert` 50. `videos.list` 1.
- Daily quotas reset at midnight Pacific Time.
- Every request costs at least 1 unit, even an invalid one. [getting started](https://developers.google.com/youtube/v3/getting-started)

CONFLICT in the official pages: the quota cost page says a `videos.insert` call costs 1 unit in its own bucket. The revision history (2025-12-04) says upload cost fell from about 1,600 to about 100 units. Either way the default is about 100 uploads per day per project. The old "6 uploads per day" figure is outdated.

Planning numbers: 100 uploads per day for ALL our users together. The 10,000-unit bucket allows about 200 thumbnails (50 each) per day, or many `videos.list` polls (1 each).

Quota extension [quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits):

- First pass an audit of compliance with the YouTube API Services Terms.
- Submit the "YouTube API Services - Audit and Quota Extension Form". The team replies "as soon as possible". No fixed time is given.
- If you passed an audit in the last 12 months, use the same form for more quota.
- Failed audit: Appeals Form.

Per-channel upload limit set by YouTube: the API returns `400 uploadLimitExceeded` ("user has passed their upload limit"). [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert) The size of this limit is UNVERIFIED.

Errors: `403 quotaExceeded` is the standard daily quota error. UNVERIFIED on the pages we read (the pages list `uploadLimitExceeded`, `forbiddenPrivacySetting`, `invalidPublishAt`, `invalidTitle`, `invalidTags`, `mediaBodyRequired`).

## Webhooks/events

- Hub `https://pubsubhubbub.appspot.com/subscribe`, topic `https://www.youtube.com/xml/feeds/videos.xml?channel_id=CHANNEL_ID`.
- PubSubHubbub (WebSub) pushes an Atom notification when a channel uploads a video or changes a title or description. [push notifications](https://developers.google.com/youtube/v3/guides/push_notifications)
- No webhook for upload or processing status. The page does not cover it.
- Poll instead: `videos.list` with `part=processingDetails,status` (1 unit). [videos resource](https://developers.google.com/youtube/v3/docs/videos)
  - `processingDetails.processingStatus`: `processing`, `succeeded`, `failed`, `terminated`. Only the owner can read it.
  - `processingDetails.processingFailureReason`: `uploadFailed`, `transcodeFailed`, `streamingFailed`, `other`.
  - `status.uploadStatus`: `uploaded`, `processed`, `failed`, `rejected`, `deleted`.

## App review / verification

Two separate reviews.

1. Google OAuth app verification [overview](https://support.google.com/cloud/answer/13463073), [scopes](https://support.google.com/cloud/answer/9110914):
   - Needed for sensitive and restricted scopes. The Cloud console marks the category when you add a scope.
   - Whether `youtube.upload` is "sensitive": UNVERIFIED on the pages we read. Expect yes.
   - Steps: publish the app to production, click "Prepare for Verification", write a scope justification, give a demo video, click "Submit for Verification". Testing apps cannot be verified. [submit for verification](https://support.google.com/cloud/answer/13461325)
   - Needs: homepage on a verified domain, privacy policy, domain ownership via Google Search Console, scope justification per scope, demo video. [requirements](https://support.google.com/cloud/answer/13464321)
   - Demo video: full end-to-end flow including the OAuth grant, the full consent screen with exact scopes in English, and each feature that uses a scope. [requirements](https://support.google.com/cloud/answer/13464321)
   - Timeline: not stated in official pages. UNVERIFIED (days to weeks is our guess). Contact is by email to project owners and editors.
   - Restricted scopes need an annual re-verification. [scopes](https://support.google.com/cloud/answer/9110914)
   - What it unlocks: removes the unverified warning and the 100 new-user cap.

2. YouTube API Services audit [quota and compliance audits](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits):
   - Needed for more quota, and to lift the private lock below.
   - Revision history, 2020-07-28: videos uploaded with `videos.insert` from unverified API projects created after 2020-07-28 are restricted to private viewing. Lifting it needs a project audit. [revision history](https://developers.google.com/youtube/v3/revision_history) Projects created before that date were not affected at that time.
   - The audit page itself does not state that the audit removes the lock. The 2020 revision entry does.
   - The lock is on the API project (a YouTube audit), not the same as Google OAuth verification. Plan to do both. The exact link between them: UNVERIFIED.

Current status for us: NOT STARTED.

## Costs

- The API is free. We found no per-call fee in the official pages. [quota cost](https://developers.google.com/youtube/v3/determine_quota_cost)
- The constraint is quota (100 uploads per day per project by default) and the audit effort.
- Paid quota: UNVERIFIED. The official route is the audit and extension form.

## Gotchas

- Videos from unaudited projects created after 2020-07-28 are locked to private. Every public post fails until the audit passes. [revision history](https://developers.google.com/youtube/v3/revision_history)
- Quota is per project, not per user. All Postit customers share 100 uploads per day until extended. Start the audit early. [quota](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits)
- Testing mode: refresh tokens die after 7 days and only 100 test users are allowed. [publishing status](https://support.google.com/cloud/answer/15549945)
- Unverified app: 100 new users in total for the project's life. [publishing status](https://support.google.com/cloud/answer/15549945)
- 100 refresh tokens per account per client. Store the newest token. Do not re-authorize without need. [OAuth overview](https://developers.google.com/identity/protocols/oauth2)
- Refresh token is returned only on first consent. Use `access_type=offline` and `prompt=consent` when reconnecting. [web server flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- Content-Range math: chunk multiple of 256 KB, no overlap, no gaps, last byte index is `size-1`. After any error, ask for status before resuming. [resumable upload](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol)
- Made for kids: the field `selfDeclaredMadeForKids` exists on insert. Whether the API rejects uploads without it: UNVERIFIED. Always send it. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
- Altered content: send `containsSyntheticMedia` when the user says so. Added to the API 2024-10-30. [revision history](https://developers.google.com/youtube/v3/revision_history)
- `publishAt` needs `privacyStatus=private`. Do not send `public` with it. [videos resource](https://developers.google.com/youtube/v3/docs/videos)
- Omitted `privacyStatus` means public. Always send it. YouTube policy: never change visibility without the user's express instruction. [developer policies](https://developers.google.com/youtube/terms/developer-policies)
- Processing delay: the video is `uploaded` first, then `processing`. Poll before telling the user it is live.
- Data rules: delete a user's data within 7 days after they revoke in our app or ask for deletion, within 30 days if they revoke at Google. Do not store YouTube video content. Re-check stored Authorized Data at least every 30 days. [developer policies](https://developers.google.com/youtube/terms/developer-policies)
- Changes found in 2025-2026 [revision history](https://developers.google.com/youtube/v3/revision_history):
  - 2026-06-01: separate quota buckets for `videos.insert` and `search.list`.
  - 2026-09-14: thumbnail max size 2 MB to 50 MB.
  - Our fetch read only part of the revision history (about 200,000 of 240,538 characters). Re-check the last part before launch.

## Sources

All read on 2026-10-27.

- https://developers.google.com/youtube/v3/getting-started
- https://developers.google.com/youtube/v3/docs/videos/insert
- https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
- https://developers.google.com/youtube/v3/docs/thumbnails/set
- https://developers.google.com/youtube/v3/docs/videos
- https://developers.google.com/youtube/v3/determine_quota_cost
- https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits
- https://developers.google.com/youtube/v3/revision_history
- https://developers.google.com/youtube/terms/developer-policies
- https://developers.google.com/youtube/terms/required-minimum-functionality
- https://developers.google.com/identity/protocols/oauth2
- https://developers.google.com/identity/protocols/oauth2/web-server
- https://developers.google.com/identity/protocols/oauth2/scopes
- https://support.google.com/cloud/answer/13463073
- https://support.google.com/cloud/answer/9110914
- https://support.google.com/cloud/answer/13464321
- https://support.google.com/cloud/answer/13461325
- https://support.google.com/cloud/answer/15549945
- https://developers.google.com/youtube/v3/guides/push_notifications
- https://support.google.com/youtube/answer/15424877
- https://support.google.com/youtube/answer/72431
- https://support.google.com/youtube/answer/12272017 (404 on 2026-10-27)
