# Stage 1: decisions made while building

Every decision taken during implementation where the plan was silent, unclear or wrong, in the order they were made. Each line says what was decided, why, and what it costs if it was the wrong call. Kept from the build ledger so the reasoning survives.

91 decisions, 3 review fixes, 11 deferred minor issues.


## Task 1

- local Node is 23.11, plan says 24 LTS — develop on installed Node, pin 24 in .nvmrc and Docker images — cost if wrong: a small runtime difference caught by container tests.
- pnpm not installed — run through corepack without changing global setup — cost if wrong: longer commands.
- NestJS 12 scaffold uses ESM and Vitest, plan says Jest — use Vitest, positional test filters — cost if wrong: none, same test intent.
- removed scaffold e2e test because it did not type-check — Task 14 adds the real end-to-end test — cost if wrong: none.
- added AiUsage callback to ClaudeAiClient and mark-test-lib helpers — mark test must print cost per page, and Task 7 logger plugs in here — cost if wrong: small refactor.
- no server-side refusal fallback — model is chosen by Stage 0 and Haiku has none; refusal becomes AiOutputInvalidError — cost if wrong: a refused page fails and can be retried.
- HEIC photos are rejected with a sips conversion command — prebuilt sharp cannot read them — cost if wrong: one extra step for the founder.
- founder replaced double/single with one underline; stored types underline_save, underline_translate, curly, unclear; whole complete sentences are translate-only, a word inside an underlined sentence is added by hand — simpler for readers — cost if wrong: some underlines saved wrongly, fixed by the save switch

## Task 2

- added a photo intake script (not in the plan) because volunteers send mixed names and HEIC files, and added its hold-back of pages for the fair check — it only prepares test data and adds no app code — cost if wrong: a small script to remove.
- an invalid box no longer fails the whole page; dropInvalidBoxes() sets it to null after parsing (a Zod transform cannot become the API JSON schema) — real photos lost 2–3 of 7 pages to this — Task 6/7 detection code must call dropInvalidBoxes too — cost if wrong: a few marks without a report box.
- founder chose to build Stage 1 before the 90% target is met (65-75% on 7 pages) — portfolio goal, required Mark check, beta label; target now applies before Stage 3 — cost if wrong: early users fix more marks by hand.
- Mark check view is list — the model returned invalid boxes on real photos and highlight accuracy is unreviewed — cost if wrong: highlights added later.

## Task 3

- local Node 23 is unsupported by Prisma 7 — .npmrc use-node-version=24.22.2 makes pnpm run the project on Node 24, matching .nvmrc, without changing system Node — cost if wrong: commands outside pnpm still use Node 23.
- Prisma 7.10.1 (latest stable; 8 is a release candidate) with the prisma-client generator into src/generated (gitignored, built by postinstall) and the pg driver adapter — cost if wrong: an upgrade later.
- PostgreSQL 18 in compose and tests — cost if wrong: change one image tag to match the host.
- login_tokens and sessions store only token hashes; their exact columns are provisional for Task 4 — cost if wrong: a small migration in Task 4.
- a card keeps its sense when its sighting is deleted (sighting_id set null); ai_calls rows are removed with their user and keep a null page_id when the page goes — cost if wrong: a migration.
- PrismaService is not yet registered in AppModule — Task 4 is the first consumer and adds the module wiring — cost if wrong: none.
- task-3 branch is stacked on task-1-mark-test-tool because merging into main needs the founder's go-ahead — cost if wrong: one merge to do later.

## Task 4

- settings modules are global (ConfigModule, PrismaModule) so every later module gets APP_CONFIG and PrismaService without imports — cost if wrong: none.
- added ALLOWED_EMAILS, APP_URL, SMTP_URL (required in production) and MAIL_FROM to AppConfig; links go to APP_URL/sign-in?token=… for the Task 12 web page — cost if wrong: Task 12 adjusts the path.
- the token is used with one conditional update (updateManyAndReturn), so two simultaneous verifies cannot both succeed; added a test — cost if wrong: none.
- cookies are read with a small readCookie() instead of cookie-parser, so tests and production share one code path — cost if wrong: swap in cookie-parser later.
- no rate limit on /auth/request-link — only allowed addresses get mail during Stage 1 — cost if wrong: someone could make the app send many emails to an allowed address. Revisit before Stage 2.

## Task 5

- SeaweedFS 4.50 instead of MinIO for local and test storage — MinIO's Docker images can no longer be pulled — cost if wrong: swap one image; the app only speaks S3.
- added S3_ENDPOINT/S3_REGION/S3_BUCKET/S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY to AppConfig (keys both or neither); the API creates the bucket on start only in development — cost if wrong: production bucket set up by hand.
- added test/s3-photo-store.int-spec.ts against a real SeaweedFS container, beyond the brief — the memory store alone would not prove the S3 code — cost if wrong: ~5 s more per integration run.
- a malformed ID returns 404 like a missing one, and ownership is checked before the upload's file and fields — no ID probing, same answer for every not-yours case — cost if wrong: clients see 404 instead of 400 for a typo.
- deleting a book deletes its photos first, then the rows — a failure can leave a page without a photo but never a photo without a page — cost if wrong: a broken photo link on a failed delete.
- added PATCH title, DELETE book, missing-photo 400 and pageCount tests beyond the brief — routes in the brief had no tests — cost if wrong: none.

## Task 6

- BullMQ 6 no longer bundles ioredis; installed ioredis 6 and pass our own connection — cost if wrong: none.
- enableOfflineQueue:false alone makes BullMQ's start-up version check fail permanently, and skipWaitingForReady makes it hang; instead the queue waits for Redis normally and enqueue throws RedisUnavailableError at once when the connection is not ready — keeps uploads fast (0.1 s with Redis down, tested) — cost if wrong: a page queued a moment after reconnect waits for the stuck check.
- three queues (detection, explanation, maintenance); the stuck-page check is a BullMQ job scheduler upserted on every worker start — cost if wrong: rename queues before any real jobs exist.
- movePage throws for a move the rules forbid, defaults failedStage to the `from` status, and clears failedStage/failureReason when leaving FAILED — cost if wrong: Task 7/9 callers pass failedStage explicitly.
- stuck DETECTING/EXPLAINING pages are re-queued without changing status, so Task 7's detection job must accept a page already in DETECTING (and Task 9's explanation job one in EXPLAINING) — cost if wrong: a stuck page is never retried.
- the worker runs only the maintenance queue for now; Tasks 7 and 9 add the detection and explanation workers — cost if wrong: none, uploaded pages wait in the queue until then.
- Redis errors are logged at most once a minute and queues get a silent error listener — a real outage run printed dozens of stack traces otherwise — cost if wrong: less detail in logs during an outage.
- added tests beyond the brief: movePage (atomic, forbidden move, failure fields), upload queues detection, enqueue fails fast, scheduler created once, worker processes the check, redisErrorWarner — cost if wrong: none.

## Task 7

- added OWNER_EMAIL (budget alert recipient; logged only when unset) and ANTHROPIC_API_KEY (required in production) to AppConfig; Mailer gains sendAlert — the spec says "the owner is alerted" without naming how — cost if wrong: change the alert channel.
- the alert is sent once per UTC month using a Redis SET NX key; with Redis down it is logged instead of emailed, so an outage cannot send one email per upload — cost if wrong: a missed alert email during an outage (still in the logs).
- budget and daily-limit checks run in LibraryService.createPage before the photo is stored; a refused page stores nothing; page.createdAt is the reservation time so release() hits the same UTC day — cost if wrong: none.
- the detection job retries every error (not only AiTransientError) and marks FAILED with a plain reason on the last attempt; usage is released on FAILED and on an unusable photo — cost if wrong: two wasted retries on a permanently bad page.
- the job accepts a page in UPLOADED or DETECTING (Task 6 stuck-page rule) and does nothing for any later status; marks are replaced inside one transaction that also moves the page, and rolled back if another run moved it first — cost if wrong: none.
- ClaudeAiClient now awaits the usage callback so each call is saved before the result is used — cost if wrong: a few ms per call.
- auth and library integration tests now point REDIS_URL at an unused port and library raises DAILY_PAGE_LIMIT — they were counting uploads in the developer's local Redis — cost if wrong: none.
- worker concurrency 2 for detection — cost if wrong: tune later.

## Task 8

- "confirm with no marks moves straight to DONE" conflicts with Task 6's rule forbidding AWAITING_CHECK→DONE; both legal moves (→EXPLAINING→DONE) run in one transaction with no AI call — keeps the state machine intact — cost if wrong: none.
- PATCH /marks/:id takes type (not unclear), save (underlines only; not together with type), text, normalForm, sentence; saved types without a dictionary form use the text; underline_translate clears it; an added mark stays `added`, others become `corrected` — spec 4 and 6.1 — cost if wrong: small API change before Task 12.
- mark edits use updateMany/deleteMany filtered on page status AWAITING_CHECK, so an edit racing a confirm gets 409 — cost if wrong: none.
- retry checks the monthly budget for both stages; a detection retry needs the photo (409 "upload again") and counts against the daily limit via UsageService.admitPage (moved out of LibraryService) — cost if wrong: a retry costs a page.
- the detection job now gives usage back on page.statusChangedAt (when the upload or retry was counted), not createdAt; added a test that failed with the old code — cost if wrong: none.
- pageView moved to library/views.ts so marks routes return the same page shape — cost if wrong: none.

## Task 9

- changed Task 8 — a saved mark the reader adds or retypes (new text, or word↔grammar) gets a null dictionary form instead of copying the text, so the resolve call reads the real form from the photo (겁먹고 → 겁먹다); updated three Task 8 tests and added two — cost if wrong: one extra resolve call per edited mark.
- the explain output schema is built per page and checks one result per mark, the right kind per mark type, and only sense IDs given for that mark; failures are invalid output so ClaudeAiClient retries once with the reason — cost if wrong: none.
- resolve fills only what is missing (an existing sentence is kept); a sentence not found, or a deleted photo, falls back to the marked text; resolved values are saved on the marks so a retry does not ask again — cost if wrong: a weaker sentence on some cards.
- saveResults skips marks that already have a sighting or translation, checks an existing sense belongs to the reader, and reuses a sense made earlier on the same page when the item and meaning (case-insensitive) match; cards are due immediately — cost if wrong: a near-duplicate sense when the model words a meaning differently.
- an explanation failure does not release daily usage (only detection counts pages) — cost if wrong: none.
- real run on person1-01.jpg: detect + resolve + explain cost $0.0042 for one page — recorded for pricing.

## Task 10

- scheduler rounds ease to two decimals (2.5 − 0.2 = 2.3 exactly) and Easy multiplies by the ease before the change — matches the brief's values — cost if wrong: slightly different intervals.
- PATCH /wordbank/:id edits one sense ({senseId, meaning?, notes?, example?, exampleTranslation?}); the dictionary form is not editable, to avoid unique-key clashes with another item — cost if wrong: users delete and re-add a wrongly named item.
- "seen before" lists other pages' sightings of the same sense, oldest first; deleting an item keeps the page's marks and translations — cost if wrong: none.
- due cards are capped at 50 per request; a card whose sighting's page was deleted falls back to another sighting, then to the example sentence with no highlight; highlight is {text, start} found after NFC normalisation — cost if wrong: none.
- added test/helpers/seed-wordbank.ts so API tests seed through the real saveResults — cost if wrong: none.

## Task 11

- retention runs in the existing MaintenanceWorker as a second job scheduler (every 24 h) instead of changing worker.ts — cost if wrong: none.
- "30 days after processing" is measured from pages.status_changed_at, whatever the status — matches the brief's test — cost if wrong: a page stuck mid-way loses its photo after 30 days (it can be re-uploaded).
- DELETE /pages/:id/photo returns 409 while UPLOADED or DETECTING (detection needs the photo), 204 if already deleted, and 500 with photo_deleted_at unchanged if storage fails — cost if wrong: none.
- DELETE /account deletes every photo first and stops (500, nothing else deleted) if one fails; then login tokens (kept by email) and the user row in one transaction; the cookie is cleared — cost if wrong: a reader retries the deletion.
- deleting an account removes its ai_calls rows (Task 3 cascade), so that month's budget total drops — cost if wrong: a deleted reader's spend no longer counts towards the cap.

## Task 12

- added photoUnusable to the page view (from detection_result.photo_usable, no migration) so the app shows "Take a new photo" instead of Retry; a detection retry now clears the old detection_result — cost if wrong: none.
- React 19 + React Router 8 + Vite 8; the web app calls /api through the Vite dev proxy so the session cookie stays same-origin; Task 14 decides the production setup — cost if wrong: a proxy or CORS change in Task 14.
- fonts are bundled with Fontsource (Gowun Batang for Korean book text, IBM Plex Sans KR for the interface) instead of Google Fonts — Google Fonts did not load in the preview, and bundling sends no request to a font service — cost if wrong: about 1–2 MB of font files cached by the browser.
- preparePhoto takes a PhotoCodec so tests can stand in for createImageBitmap and canvas (jsdom has neither); checked in a real browser: a 4284×5712 photo became 1500×2000, upright — cost if wrong: none.
- the Mark check is list-only (Task 2 chose list); the photo is behind "Compare with your photo"; the save switch sits on every underline row; tapping a mark opens Underline / Curly line / Remove — cost if wrong: a layout change.
- added a Capture test (unreadable file shows the error) and status-screen tests beyond the brief; DONE shows a placeholder until Task 13 — cost if wrong: none.
- committed .claude/launch.json (api and web dev servers; ALLOWED_EMAILS falls back to check@example.com when empty) — cost if wrong: none.

## Task 13

- deletions (word bank item, account, page photo) ask with an in-page second button that names what goes, instead of window.confirm — testable and clearer on phones — cost if wrong: none.
- results replace the DONE placeholder inside PageScreen; "Delete photo" sits under the results; navigation is a header row (Books, Word bank, Review, Settings) — cost if wrong: a layout change.
- word bank rows stack the form above the meaning after a browser check showed long meanings squeezing short forms (-며 wrapped) — cost if wrong: none.
- review reloads due cards when the list runs out, so cards rated Again come back in the same session — cost if wrong: none.

## Task 14

- AI_PROVIDER (anthropic | fake) with a scripted DemoAiClient for the end-to-end test and keyless trial; config refuses fake in production — cost if wrong: none.
- prisma CLI moved to dependencies so the single API image can run `prisma migrate deploy` as Railway's pre-deploy step — cost if wrong: ~larger image.
- the app services in docker-compose sit behind the `app` profile (NODE_ENV=development there for logged sign-in links and bucket creation), so `docker compose up -d` still starts only infrastructure for development — cost if wrong: the e2e command needs `--profile app`.
- the web image is nginx-unprivileged serving the build and proxying /api to API_UPSTREAM, so the cookie stays first-party in production — cost if wrong: none.
- the end-to-end test reads sign-in links from the api log (no mail server in the stack) and deletes its e2e@example.com account at the start and end, so it repeats cleanly; it was written after the images, so its first failures were in the test helper (reused link, colour codes in logs), not the app — cost if wrong: none.
- docs/deployment.md requires `?family=0` on Railway's REDIS_URL (Railway's ioredis guidance for its IPv6 private network); nginx listens on IPv4 and IPv6; the API enables shutdown hooks — cost if wrong: none.

## Final review

- confirm and already-queued jobs do not check the budget — spec 10 pauses new pages only; overrun is bounded by admitted pages — cost if wrong: a few cents past the cap.
- no rate limit on /auth/request-link — stands from ruling 4e, only allowlisted addresses get mail — cost if wrong: mail to the owner can be spammed; revisit before Stage 2.
- CSRF relies on SameSite=lax — only low-impact POSTs, and a custom domain removes the up.railway.app question — cost if wrong: a forged action from a sibling Railway site; use a custom domain before Stage 2.
- dictionary forms are not editable (ruling 10b stands) — cost if wrong: users delete and re-add a misnamed item.
- Stage 0 accuracy target unmet — the founder's documented decision (spec 12) — cost if wrong: more hand corrections.
- no pagination on the word bank (due cards capped at 50) — sized for one reader in Stage 1 — cost if wrong: a slow list after thousands of items.

## Fixed after the final review

- same word twice on a page with differently worded meanings gave two senses and two cards — saveResults reuses one sense per item per page — "keeps one sense and one card for a word marked twice on a page, even when the two meanings are worded differently" RED→GREEN, suite 162/147/29 + e2e.
- nginx resolved API_UPSTREAM once at start (crash when the API is absent, stale address after a redeploy) — resolver from NGINX_ENTRYPOINT_LOCAL_RESOLVERS, variable upstream with regex location keeping the query string — reproduced RED in compose (web exited: host not found), GREEN: web starts without the API (502), follows a recreated API to a new address in ~2 s, ?kind=noun reaches the API (400), e2e passes. Railway's resolver address is not documented, so nothing is hard-coded.
- the waiting screen stopped polling after one failed request — keeps polling with backoff (max 30 s) and shows the error in the waiting state — "keeps checking after a failed request while the marks are read, and says so" RED→GREEN, web 29/29.

## Deferred minor issues (from the final review)

Not fixed in Stage 1. Each is small; decide before Stage 2.

- ai_calls cascade on account deletion lowers the month's budget total — reviewer disagrees with ruling 11e; use SetNull before Stage 2.
- Mark check UI cannot edit a mark's text (PATCH already accepts text); misread or cut-short marks need remove and re-add.
- Retry in the instant a job finally fails can no-op on the still-present failed job ID; page waits for the stuck check.
- findHighlight computes start on the NFC sentence but returns the original sentence.
- readCookie decodeURIComponent throws on a malformed cookie → 500 instead of 401.
- expired sessions and login tokens are never cleaned up.
- countedOn for a page already in DETECTING is the DETECTING time, wrong only across UTC midnight.
- a page that crashes the worker every time is re-queued forever by the stuck check (bounded by the budget).
- AI_MODEL has a code default (claude-haiku-5-5) against the plan's "no model default"; make it required in production.
- the empty Mark check has no retake link (spec 10).
- two pages explained at the same time can create duplicate senses for the same new word (spec accepts duplicates).

## Publish-readiness pass (2026-11-10 to 2026-11-12)

Decisions made while fixing sign-in, auditing, redesigning on Astryx and preparing to publish.

- In development with no email service, the sign-in screen shows the link itself (and says when an address is not allowed); production and any setup with SMTP_URL always answer an empty 202 — the link was only in the server log before, which looked like a broken sign-in — cost if wrong: none, it cannot happen in production.
- SIGN_UP=allowlist (default) or open; production refuses an allowlist with nobody on it; local Docker and the dev launcher default to open — cost if wrong: one setting.
- Sign-in links are limited to 5 per address per 15 minutes and 300 an hour app-wide, counted in Redis with the address hashed; if Redis is down the link is still sent — closes the rate limit deferred in Task 4 — cost if wrong: a locked-out reader waits 15 minutes.
- A failed email send answers 503 with a plain message instead of pretending it was sent; this tells an allowed address apart from a stranger only while the email service is down — cost if wrong: a small leak of who is allowed during an outage.
- ai_calls keep their rows when an account is deleted (user_id set to null), so the monthly budget cannot be lowered by deleting an account — reverses the Task 3 and Task 11 rulings, as the final review advised — cost if wrong: none.
- Retry queues a job with its own ID; pages stuck in DETECTING or EXPLAINING for over an hour are failed instead of re-queued forever; expired sessions and day-old sign-in links are removed daily — cost if wrong: a page that would have finished after an hour needs a Retry.
- Requests that change something are refused when the browser says they come from another site (Origin must equal APP_URL) — APP_URL must therefore match the public address exactly — cost if wrong: a wrong APP_URL blocks every action, which the deployment guide calls out.
- The web app is rebuilt on Astryx 0.7 (beta) with a local theme extending neutral; the app keeps its own CSS only for pencil marks, the card highlight and the waiting line; dark mode follows the device — cost if wrong: the JavaScript bundle is about 310 kB compressed (was 87 kB), and Astryx is pre-1.0, so upgrades may need `astryx upgrade`.
- The interface font ships only its Latin files and the book serif carries Korean; fonts are declared in the theme's fonts stylesheet — halves the compressed CSS — cost if wrong: Korean in interface text falls back to the system font.
- nginx sends a Content-Security-Policy (own origin only; inline styles and embedded fonts allowed because the design system and build need them), no-sniff, referrer and HSTS headers, and compresses text; the end-to-end test fails if the policy blocks anything — cost if wrong: a new outside resource must be added to the policy.
- Still deferred: usage given back to the wrong day across UTC midnight; two pages explained at once can duplicate a new word's sense; AI_MODEL has a default in code; confirm does not check the budget.
