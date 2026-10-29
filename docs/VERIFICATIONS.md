# Postit platform verifications

Plain-English tracker. Facts come from `docs/integrations/*.md`. Each fact names its source file in brackets. "UNVERIFIED" means the source file marks it so. Today: 2026-10-27.

Short version: no platform can serve real users yet. Meta is in progress. Bluesky needs nothing.

## 1. Status board

| Platform | Approval needed | Status | What works before approval | What is blocked before approval | Published timeline |
|---|---|---|---|---|---|
| Meta Business Verification (shared by Instagram, Facebook, Threads) | Business Verification for Advanced Access [facebook.md] | IN PROGRESS | Test use by people with a role on the app (Admin, Developer, Tester) [facebook.md, instagram.md] | Anyone without a role cannot use the app. Advanced Access needs it [facebook.md] | Not stated in docs. UNVERIFIED [facebook.md] |
| Instagram | App Review + Business Verification for Advanced Access [instagram.md] | IN PROGRESS | Standard Access. Users with a role on the app [instagram.md] | Any user without a role. Publishing for public users needs Advanced Access for `instagram_business_basic` and `instagram_business_content_publish` [instagram.md] | Not stated in docs. UNVERIFIED [instagram.md] |
| Facebook Pages | App Review + Business Verification for Advanced Access [facebook.md] | IN PROGRESS (verification). App Review NOT STARTED | Test users (max 10) and users with a role on the app [facebook.md] | Any public user. Page posting needs approved permissions [facebook.md] | Not stated in docs. UNVERIFIED [facebook.md] |
| Threads | App Review for `threads_content_publish`. Business Verification is needed for Advanced Access [threads.md] | NOT STARTED (Meta verification is in progress for the same business) | Posting for Threads testers only [threads.md] | Non-tester users until the permission is approved and the app is published [threads.md] | Not stated in docs. UNVERIFIED [threads.md] |
| TikTok | App review (portal) for `video.publish`, then Content Posting API audit [tiktok.md] | NOT STARTED | Sandbox use with accounts you own. Login Kit works in sandbox [tiktok.md] | Public posting. Unaudited posts are forced private. Max 5 users per 24 h [tiktok.md] | Not stated in docs. UNVERIFIED [tiktok.md] |
| Pinterest | Trial access (form), then Standard access (review with demo video) [pinterest.md] | NOT STARTED | Trial: 1,000 calls per day per app. Pins and boards are private to the creator [pinterest.md] | Real customers. Trial pins are private only [pinterest.md] | Trial: not published. Standard: 2 to 4+ weeks in community reports, not official [pinterest.md] |
| YouTube | Google OAuth verification (for sensitive scopes) and YouTube API Services audit [youtube.md] | NOT STARTED | Testing mode: max 100 test users. Authorizations expire after 7 days [youtube.md] | Public users. Unverified projects: uploads are locked to private. Max 100 new users in total, for the life of the project [youtube.md] | Not stated in docs. UNVERIFIED. "Days to weeks" is a guess [youtube.md] |
| LinkedIn | Community Management API (vetted). Development tier, then Standard tier [linkedin.md] | NOT STARTED | Sign In with LinkedIn and Share on LinkedIn (personal posts, `w_member_social`) are self-serve [linkedin.md] | Company Page posting. Needs Community Management API approval [linkedin.md] | Not stated in docs. UNVERIFIED [linkedin.md] |
| X (Twitter) | No manual approval step described for pay-per-use. Use case is reviewed [x.md] | NOT STARTED | Posting after signup and a funded account. Pay-per-use [x.md] | Any use may break the "limited end-users" rule. White-label use needs X approval [x.md] | Not stated in docs. UNVERIFIED [x.md] |
| Bluesky | NOT NEEDED. No app review, no registration [bluesky.md] | NOT NEEDED | Everything. OAuth is open [bluesky.md] | Nothing from approvals. Bluesky developer rules still apply [bluesky.md] | Not needed |

## 2. Shared prerequisites

Each item is a checklist item. Reviews ask for most of these. Source file in brackets.

- [ ] Public privacy policy URL, live on a domain you own. [linkedin.md, youtube.md, threads.md, instagram.md, pinterest.md]
- [ ] Terms of service URL, live and linked from the homepage. [tiktok.md, youtube.md, instagram.md]
- [ ] Data deletion callback URL, or a data deletion instructions page. Set in Basic Settings. [facebook.md, instagram.md, threads.md]
- [ ] Deauthorize callback URL. Set in App Settings. [threads.md]
- [ ] Support email address. [youtube.md]
- [ ] Verified domain. Needed for TikTok pull-from-URL and for the Google homepage. [tiktok.md, youtube.md]
- [ ] Official website that is not only a login page. Must link the privacy policy. [tiktok.md, youtube.md]
- [ ] Business legal entity and documents. Needed for Meta Business Verification and the LinkedIn Community Management API. Documents accepted by Meta: UNVERIFIED. [facebook.md, linkedin.md]
- [ ] Verified business email. Personal email fails for LinkedIn. [linkedin.md]
- [ ] Screencast or demo video of the live OAuth and posting flow. Needed for Meta, TikTok, Pinterest, Google, LinkedIn. [facebook.md, tiktok.md, pinterest.md, youtube.md, linkedin.md]
- [ ] Live app URL that the reviewer can open. [tiktok.md, linkedin.md]
- [ ] Test accounts per platform:
  - Instagram: testers with a role on the app. [instagram.md]
  - Threads: Threads Tester role. [threads.md]
  - Facebook: up to 10 test users, and an app-scoped test Page. [facebook.md]
  - TikTok: sandbox, up to 5 sandboxes, up to 10 target users each. [tiktok.md]
  - Pinterest: sandbox at `api-sandbox.pinterest.com`. [pinterest.md]
  - Google: up to 100 test users. [youtube.md]
  - LinkedIn: Development tier. [linkedin.md]
- [ ] Working app that passes Meta's test. Meta rejects the whole submission if it cannot test the app. [facebook.md]

## 3. Per-platform steps

### Instagram [instagram.md]

1. Create a Business app. Type None cannot be used. [instagram.md section 2]
2. Open App Dashboard > Instagram > API setup with Instagram business login. Generate a token for an account you own.
3. Add the redirect URI in Business login settings. It must match exactly, with the trailing slash.
4. Set up the webhooks server. It is a prerequisite.
5. Add the privacy policy URL, terms URL and data deletion method.
6. Add testers. The tester steps are UNVERIFIED.
7. Request `instagram_business_basic` and `instagram_business_content_publish`. Advanced Access is needed for both for public users.
8. Complete Business Verification in App Dashboard > Settings > Basic > Verification.
9. Submit App Review. Meta tests each permission.

Status: IN PROGRESS (Business Verification).
Blocked by: Meta Business Verification, then App Review for Advanced Access.

### Facebook Pages [facebook.md]

1. Create a Business app. Facebook Login for Business is the preferred login for business use.
2. Create a configuration in App Dashboard > Facebook Login for Business > Configurations. Pass `config_id` at login.
3. Add all callback URLs under Valid OAuth Redirect URIs.
4. Set the privacy policy URL, app icon, category, business email and platforms in App Settings.
5. Set the Data Deletion Request URL or the deletion instructions URL.
6. Request `pages_manage_posts`, `pages_read_engagement`, `pages_show_list`, `publish_video`, and `pages_manage_metadata` (for webhooks).
7. Complete Business Verification in App Dashboard > Settings > Basic > Verification.
8. Submit App Review with use cases and screencasts. The Video API says all its permissions need review.
9. Annual Data Use Checkup is needed after Advanced Access.

Status: IN PROGRESS (verification). App Review NOT STARTED.
Blocked by: Meta Business Verification. Then App Review for Advanced Access.

### Threads [threads.md]

1. In the Meta developer portal, create an app with the use case "Access the Threads API". App type: UNVERIFIED (probably Business).
2. Use the Threads app ID and secret, not the Facebook ones.
3. Add redirect URIs under Threads use case > Settings > Client OAuth Settings. Must match exactly.
4. Set the deauthorize callback, the data deletion URL, and the privacy policy URL.
5. Add testers: App roles > Roles > Add People > "Threads Tester". The tester accepts in Threads account settings.
6. Request `threads_basic` (required) and `threads_content_publish`.
7. Add the webhook sub-use case if you want replies, deletes or mentions. Scopes: `threads_read_replies`, `threads_delete`, `threads_manage_mentions`.
8. Submit App Review. Screencast must show Threads login, account linking, creating a post and viewing it in the Threads app. Source is a search summary. Confirm.

Status: NOT STARTED.
Blocked by: App Review for `threads_content_publish`. Business Verification for Advanced Access.

### TikTok [tiktok.md]

1. Create the app at developers.tiktok.com (Manage apps).
2. Add products: Login Kit and Content Posting API. Turn on Direct Post.
3. Add redirect URIs: max 10, under 512 characters, absolute, `https`, no query string, no `#`.
4. Add a verified domain by adding a DNS signature string. Needed for pull-from-URL.
5. Use the sandbox for development (no review needed). Sandbox does not give public Content Posting.
6. Submit the app review in the portal for `video.publish`. Show the full flow and every scope. Upload a demo video (up to 5 files, 50 MB each). The domain in the video must match the website URL.
7. Apply for the Content Posting API audit at developers.tiktok.com/application/content-posting-api.
8. Reviewer checks the audit items: privacy dropdown with no default, commercial content toggle off, music usage confirmation, comment/duet/stitch unchecked by default, preview and nickname shown.

Status: NOT STARTED.
Blocked by: App review and the audit. Until audit passes, posts are private (`SELF_ONLY`). Max 5 users per 24 h.

### Pinterest [pinterest.md]

1. Log in or create a Pinterest business account. Verify the email.
2. Open My apps. Accept the Developer Terms of Service.
3. Click Connect app. Fill in app info, use case and privacy policy link. Request Trial access.
4. Add redirect URIs under My apps > Manage > Configure > Redirect URIs. Must match exactly. `localhost` is allowed for tests.
5. Use the sandbox (`https://api-sandbox.pinterest.com/v5`) with a separate sandbox token. Sandbox does not support video Pin creation.
6. Apply for Standard access under My apps > Upgrade on the app card. Add use case, privacy link, and the demo video.
7. Demo video must show a live OAuth flow, not mockups. Terminal or Postman recordings are fine for solo developers.
8. Reviewers deny apps with no OAuth flow, non-OAuth login, or no live integration.

Scopes: not in the sections read for this table. See pinterest.md section 3.

Status: NOT STARTED.
Blocked by: Trial pins are private. Standard access needs Trial first, then a live OAuth demo video.

### YouTube (Google) [youtube.md]

1. Create a project in the Google Cloud console.
2. Enable YouTube Data API v3 (API Library).
3. Set up the OAuth consent screen: app name, support email, logo, homepage, privacy policy, terms, authorized domains, developer contact.
4. Declare scopes. Expect `youtube.upload` to be sensitive. This is UNVERIFIED.
5. Create OAuth client credentials of type "web server". Redirect URIs must be HTTPS (except localhost), with an exact match.
6. Publish the app to production. Click "Prepare for Verification". Write a scope justification.
7. Add a homepage on a verified domain. Add the privacy policy on the same domain.
8. Record the demo video: the full OAuth grant, the consent screen with exact scopes in English, and each feature that uses a scope.
9. Click "Submit for Verification". Testing apps cannot be verified.
10. Apply for the YouTube API Services audit (Audit and Quota Extension Form). Needed to lift the private lock on uploads from unverified projects.

Status: NOT STARTED.
Blocked by: Google OAuth verification (no public users until done). Audit (uploads stay private until done).

### LinkedIn [linkedin.md]

1. Create a LinkedIn Page for the company.
2. Create a developer app at linkedin.com/developers/apps/new. Link it to the Page.
3. A Page super admin must verify the app.
4. Add products: Sign In with OpenID Connect (`openid`, `profile`, `email`), Share on LinkedIn (`w_member_social`), and Community Management API (`w_organization_social` and more).
5. Set redirect URLs on the Auth tab. Must be HTTPS, absolute, no `#`.
6. Add the privacy policy URL to the access request form. Check the app name and logo: no "LinkedIn" or "Microsoft" names or logos.
7. Apply for Community Management API. Needs a legal organization, commercial use, verified business email, legal name, address, website, privacy policy.
8. Development tier review. Then Standard tier, which needs a screencast of each use case.
9. If rejected, you cannot re-apply with the same app. Create a new app.

Status: NOT STARTED.
Blocked by: Community Management API approval (legal entity and Page super admin needed).

### X (Twitter) [x.md]

1. Sign in at console.x.com. Create an app. Enter name, description and use case.
2. Under User authentication settings, choose OAuth 2.0 with app type Web App (confidential).
3. Add the callback URL (exact match, `https` in production).
4. Add website, terms and privacy URLs. Field names are UNVERIFIED in the docs.
5. Fund the pay-per-use account. Set a spend limit.
6. Send the white-label question to X through the Policy Support form.
7. Keep the use case current. It is binding. Do not register several apps for one use case.

Scopes: not in the sections read for this table. See x.md section 3.

Status: NOT STARTED.
Blocked by: funding, and an answer on white-label and "limited end-users" use.

### Bluesky [bluesky.md]

1. No developer portal and no API key.
2. Host a client metadata JSON file at a public HTTPS URL. That URL is the `client_id`. It must return HTTP 200 with no redirect.
3. Set `grant_types`, `scope` (`atproto transition:generic`), `response_types`, `redirect_uris`, and `dpop_bound_access_tokens: true`.
4. For a server app (confidential client): add `private_key_jwt`, `ES256`, and public keys in `jwks` or `jwks_uri`.
5. Set `client_name`, `logo_uri`, `tos_uri` and `policy_uri`. Recommended, not required.

Status: NOT NEEDED.
Blocked by: nothing from approvals. Bluesky developer rules still apply (spam, reporting, a monitored contact email).

## 4. Order of attack

1. Meta Business Verification first. It is already in progress. It gates Advanced Access for Instagram, Facebook and Threads. [facebook.md, instagram.md, threads.md]
2. Google OAuth verification and the YouTube audit next. Both are slow and need a verified domain, a homepage, a privacy policy and a demo video. Start them early. [youtube.md]
3. LinkedIn Community Management in parallel with step 2. It needs a legal entity, a Page, and a Page super admin. Expect a development tier first. [linkedin.md]
4. X in parallel. Fund the account and send the white-label question to X first. No review queue is described. [x.md]
5. TikTok after the adapter exists and works in sandbox. The audit needs a working demo. [tiktok.md]
6. Pinterest after the live OAuth flow works. Apply for Trial first, then Standard with the demo video. [pinterest.md]
7. Threads after Meta verification. It uses the same business. [threads.md]
8. Bluesky when the adapter is ready. No approval step. [bluesky.md]

## 5. Money items

- X: pay-per-use, no subscription, no minimum. Post create $0.015 per request. Post create with URL $0.200 per request. Summoned reply $0.010. Media metadata $0.005. Read posts $0.005 per resource. Read users $0.010 per resource. Owned reads $0.001 per resource. Cap of 3 million post reads per month. Media upload price UNVERIFIED. Bonus: $20 credit after first card and purchase. Credits expire 3 months after grant. [x.md section 8]
- X: Activity API `post.create` events cost $0.005 each. Not needed for v1. [x.md section 6]
- LinkedIn: no API fee stated. Development tier limits: 500 per app and 100 per member per day. Standard tier numbers UNVERIFIED. [linkedin.md sections 5, 8]
- Meta (Instagram, Facebook, Threads): no fee found. Expected free. Explicit statement UNVERIFIED. [instagram.md, facebook.md, threads.md section 8]
- TikTok: no API fee stated. Expected free. Real cost is audit work. [tiktok.md section 8]
- Pinterest: no API fee found. Treat as free. [pinterest.md section 8]
- YouTube: API is free. Default quota 10,000 units per day per project. Uploads: about 100 per day per project. Paid quota UNVERIFIED. The route is the audit and extension form. [youtube.md section 8]
- Bluesky: free. Paid tier not seen. [bluesky.md section 8]

## 6. Log

- 2026-10-27: tracker created from docs/integrations/*.md. Meta Business Verification in progress; all others not started.
