# Chekmark Stage 0 and Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that pencil marks can be read from phone photos, then build and deploy the personal version of the app.

**Architecture:** One NestJS codebase starts as an API process and a worker process. PostgreSQL is the source of truth, BullMQ on Redis holds pending work, and S3-compatible storage holds photos. A small React app is the phone-first frontend.

**Tech Stack:** Node.js 24 LTS, TypeScript, NestJS, Prisma, PostgreSQL, BullMQ, Redis, S3-compatible storage, Zod, React, Vite, Jest, Vitest, Testcontainers, Playwright, Docker Compose, pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-11-05-marked-page-study-design.md`

## Global Constraints

- Marks: straight underline on a word, phrase or part of a sentence = `underline_save`, saved; straight underline on one or more complete sentences = `underline_translate`, not saved; curly line = `curly`, grammar, saved. The reader can switch saving on or off for any underline in the Mark check.
- The app never guesses an unclear mark. It stores `unclear`, and the reader must resolve it before confirming.
- First version: Korean books, English explanations, TOPIK 3–4 level, one photo at a time.
- Daily limit: 5 pages per user, as a setting. Photos that cannot be used do not count.
- Photos are deleted 30 days after processing, or sooner on request.
- Full page text is never stored. Only marked text and the sentences containing it are kept.
- No user content is shown to another user. Requests for another user's data return 404.
- Only the `ai` module calls the Claude API. Every call is logged to `ai_calls`.
- Photos of books are never committed. `private-test-data/` is gitignored.
- Review ratings are exactly Again, Hard and Easy.
- TDD for all logic: failing test, minimal code, passing test, commit.
- Git: `main` always works. Each task is built on its own branch, named `task-<number>-<short-name>`, and merged into `main` after its tests pass.
- Git: never commit `.env`, API keys or photos of books. Check `git status` before each commit.
- GitHub: keep the repository private until Stage 1 is complete, then check its history for secrets and book photos before making it public as a portfolio project.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

- The same word marked twice on one page should create one item, one sense and one card (test in Task 9).
- Korean text in decomposed Unicode, or with extra spaces, should match the existing word bank item (test in Task 9).
- Another user's book, page, mark, item or card ID should return 404 and reveal nothing (tests in Tasks 5, 8, 10).
- A non-image, oversized or HEIC upload should get a clear rejection, not a server error (test in Task 5).
- A double tap on Confirm or Retry should queue one job, and the second request should return 409 (test in Task 8).

## Decisions Added by This Plan

These fill details the spec left to the plan.

| Decision | Value |
|---|---|
| Hosting | Railway for containers, PostgreSQL and Redis; Cloudflare R2 for photos. Check current pricing when creating the accounts |
| Who can sign in during Stage 1 | Only addresses in `ALLOWED_EMAILS` |
| Sign-in link | Expires after 15 minutes and works once; session lasts 30 days in an `httpOnly` cookie |
| Monthly AI budget | `AI_MONTHLY_BUDGET_USD`, starting at 20 |
| Photo format | JPEG, longest edge 2000 px, quality 0.85, maximum upload 10 MB |
| Day boundary for limits | UTC |
| Extra tables | `login_tokens`, `sessions` |
| Extra `marks` columns | `normal_form`, `sentence` |
| Extra `pages` column | `failed_stage` (`DETECTING` or `EXPLAINING`) |

## File Structure

```text
apps/api/
  prisma/schema.prisma
  scripts/mark-test.ts          Stage 0 test tool
  src/main.ts                   API process
  src/worker.ts                 Worker process
  src/config/                   Validated environment settings
  src/ai/                       AiClient, Claude and fake clients, call logging
  src/accounts/                 Sign-in, sessions, usage limits, account deletion
  src/library/                  Books and pages
  src/photos/                   PhotoStore and retention
  src/detection/                Schema, prompt, scoring, job
  src/marks/                    Mark check API
  src/explanation/              Schema, prompt, job
  src/wordbank/                 Matching, saving, word bank API
  src/review/                   Scheduler, cards, review API
  src/jobs/                     Queues, page status rules, stuck-page check
  test/                         Test helpers and integration tests
apps/web/
  src/api.ts                    Typed API client
  src/photo.ts                  Resize and convert photos
  src/pages/                    One file per screen
e2e/                            Playwright test
docker-compose.yml              Local PostgreSQL, Redis and MinIO
private-test-data/              Gitignored photos and answers
docs/stage-0-results.md         Mark test results
```

---

# Part 1: Stage 0, the mark test

No product code is written until Task 2 passes.

### Task 1: Project setup and mark test tool

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.gitignore`, `.env.example`, `apps/api/` (NestJS scaffold)
- Create: `apps/api/src/ai/ai-client.ts`, `apps/api/src/ai/claude-ai-client.ts`
- Create: `apps/api/src/detection/detection.schema.ts`, `detection.prompt.ts`, `score-marks.ts`
- Create: `apps/api/scripts/mark-test.ts`
- Test: `apps/api/src/ai/claude-ai-client.spec.ts`, `apps/api/src/detection/detection.schema.spec.ts`, `score-marks.spec.ts`

**Interfaces:**
- Produces:

```ts
type AiPurpose = 'detect' | 'resolve' | 'explain';
interface AiRequest<T> {
  purpose: AiPurpose; system: string; prompt: string;
  schema: z.ZodType<T>; imageJpeg?: Buffer; userId?: string; pageId?: string;
}
interface AiClient { generate<T>(req: AiRequest<T>): Promise<T>; }
class AiOutputInvalidError extends Error {}
class AiTransientError extends Error {}

type MarkType = 'underline_save' | 'underline_translate' | 'curly' | 'unclear';
const detectionResultSchema: z.ZodType<DetectionResult>;
// box is [left, top, right, bottom], scaled 0–1000, or null
interface DetectedMark {
  type: MarkType; text: string; normal_form: string | null;
  sentence: string; box: [number, number, number, number] | null;
}
interface DetectionResult { photo_usable: boolean; problem: string | null; marks: DetectedMark[]; }
function scoreMarks(expected: ExpectedPage[], actual: ActualPage[]): MarkScore;
```

- [ ] **Step 1: Set up the repository**

Run `git init -b main`. Gitignore `private-test-data/`, `.env` and `node_modules`, then make the first commit on `main` with `.gitignore` and `docs/`. The founder creates a private GitHub repository and adds it as `origin`. Create branch `task-1-mark-test-tool`, then create the pnpm workspace and scaffold NestJS in `apps/api`.

- [ ] **Step 2: Write the failing schema and scoring tests**

```ts
it('accepts each mark type and rejects any other type');
it('requires problem text when photo_usable is false');
it('requires normal_form on underline_save and curly marks and null on underline_translate marks');

it('counts a mark correct only when text and type both match', () => {
  const s = scoreMarks(
    [{ file: 'a.jpg', marks: [{ type: 'underline_save', text: '사과' }, { type: 'curly', text: '-(으)ㄹ 뻔하다' }] }],
    [{ file: 'a.jpg', marks: [{ type: 'underline_save', text: '사과' }, { type: 'underline_translate', text: '-(으)ㄹ 뻔하다' }] }],
  );
  expect(s.overall).toBe(0.5);
  expect(s.byType.underline_save).toBe(1);
  expect(s.byType.curly).toBe(0);
});
it('ignores whitespace and Unicode form when comparing text');
it('counts an unclear label as incorrect');
it('counts a mark that was not in the answers against overall accuracy');
it('passes only at overall >= 0.9 with every type >= 0.8');
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter api test -- detection score-marks`
Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Implement the schema and `scoreMarks`**

Overall accuracy is correct marks divided by expected marks plus unmatched detected marks. Normalise text with NFC and remove whitespace before comparing.

- [ ] **Step 5: Write the failing `ClaudeAiClient` tests using a stubbed SDK**

```ts
it('sends the image as JPEG when imageJpeg is present');
it('retries once with the validation error when output fails the schema');
it('throws AiOutputInvalidError when the retry is also invalid');
it('throws AiTransientError on a timeout, 429 or 5xx response');
```

- [ ] **Step 6: Implement `ClaudeAiClient`**

Load the `claude-api` skill first for current SDK usage. Read the model from `AI_MODEL`, with no default in code. The detection prompt tells the model to report any mark it cannot classify as `unclear`.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm --filter api test -- detection score-marks claude-ai-client`
Expected: PASS

- [ ] **Step 8: Implement `scripts/mark-test.ts`**

Commands:

```bash
pnpm --filter api mark-test --draft
pnpm --filter api mark-test --model <model-id>
```

`--draft` writes `private-test-data/answers.draft.json` from one detection run. The normal command resizes each photo with `sharp` to the agreed photo format, scores the result, and writes `private-test-data/report.html` showing each photo with its boxes, expected marks and detected marks.

- [ ] **Step 9: Commit**

```bash
git add .
git commit -m "feat: add mark test tool and AI client"
```

### Task 2: Run the mark test (gate)

**Files:**
- Create: `docs/stage-0-results.md`

**Interfaces:**
- Produces: the chosen `AI_MODEL`, and the Mark check view (`highlights` or `list`) used by Task 12.

The founder does steps 1–3. Anthropic API keys must be entered by the founder in `.env`.

- [ ] **Step 1: Mark about 20 real pages using the new system**

Include curved pages, poor light, short words, very short sentences, underlines that stop partway through a sentence, and curly marks inside underlined sentences. Use everyday handwriting.

- [ ] **Step 2: Photograph the pages normally and put them in `private-test-data/`**

Put each person's originals in `private-test-data/inbox/<person>/`, then run `corepack pnpm --filter api intake`. It converts them to JPEG, names them like `person1-01.jpg`, removes metadata including location, and skips exact duplicates. It's safe to run again as more photos arrive. Before the first draft, add `--hold-back 10` to keep 10 pages in `private-test-data/held-back/` for a fair check after any prompt change.

- [ ] **Step 3: Create `private-test-data/answers.json`**

Run the `--draft` command, then correct every entry while looking at the page. Check all of it, because the draft can miss marks or get them wrong.

- [ ] **Step 4: Run the test on each candidate model**

Start with the lowest-cost current vision model and move up only if it fails.
Expected: the command prints overall accuracy, accuracy per mark type, and cost per page.

- [ ] **Step 5: Review highlight accuracy in `report.html`**

Choose `highlights` if the boxes clearly identify the right marks on at least 90% of marks. Otherwise choose `list`.

- [ ] **Step 6: Record the results and decision in `docs/stage-0-results.md`**

Include the scores, cost per page, chosen model, Mark check view and the most common errors.

- [ ] **Step 7: Apply the gate**

Pass: overall accuracy is at least 90% and no mark type is below 80%.
If it fails: **stop here**. Change the prompt, the marks or the detection method, then rerun this task. Do not start Task 3.

- [ ] **Step 8: Commit**

```bash
git add docs/stage-0-results.md
git commit -m "docs: record stage 0 mark test results"
```

---

# Part 2: Stage 1, the personal version

### Task 3: Docker, PostgreSQL and the data model

**New concepts:** Docker Compose, relational schemas, migrations.

**Files:**
- Create: `docker-compose.yml` (PostgreSQL only for now), `apps/api/prisma/schema.prisma`, `apps/api/src/prisma/prisma.service.ts`, `apps/api/src/config/config.ts`, `apps/api/test/helpers/test-db.ts`
- Test: `apps/api/test/schema.int-spec.ts`, `apps/api/src/config/config.spec.ts`

**Interfaces:**
- Produces: `PrismaService`; `startTestDb(): Promise<{ prisma: PrismaClient; stop(): Promise<void> }>`; `loadConfig(env): AppConfig`, which validates settings with Zod.

- [ ] **Step 1: Write the failing integration tests**

```ts
it('allows one item per user, kind, language and normal_form');
it('allows one sighting per mark and one translation per mark');
it('allows one card per sense');
it('deleting a user removes all of their rows');
it('rejects a page status outside the five allowed values and FAILED');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- schema`
Expected: FAIL because the schema does not exist.

- [ ] **Step 3: Write `schema.prisma` and the first migration**

Use the tables in spec section 8, without a `jobs` table, plus the additions in "Decisions Added by This Plan". Index `cards(due_at)`, `pages(status, status_changed_at)` and `ai_calls(created_at)`. Set `explanation_language` to default to `en`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- schema`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/api
git commit -m "feat: add database schema and test database"
```

### Task 4: Sign-in with one-time links

**Files:**
- Create: `apps/api/src/accounts/auth.controller.ts`, `auth.service.ts`, `session.guard.ts`, `mailer.ts`
- Test: `apps/api/test/auth.int-spec.ts`

**Interfaces:**
- Consumes: `PrismaService`, `AppConfig`
- Produces: `SessionGuard` and `@CurrentUser()`, which give `{ id: string; email: string }`; `Mailer { sendSignInLink(email: string, url: string): Promise<void> }`
- Routes: `POST /auth/request-link`, `POST /auth/verify`, `POST /auth/logout`, `GET /me`

- [ ] **Step 1: Write the failing tests**

```ts
it('sends a link to an allowed email and creates the user on first verify');
it('returns 202 and sends nothing for an email outside ALLOWED_EMAILS');
it('rejects a token after 15 minutes');
it('rejects a token used a second time');
it('stores only a hash of the token and the session ID');
it('returns 401 from GET /me after logout');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- auth`
Expected: FAIL

- [ ] **Step 3: Implement the service, guard and mailer**

Use `nodemailer` with SMTP settings. Use a `LogMailer` in development and tests. Set the session cookie as `httpOnly`, `sameSite=lax`, and `secure` in production.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- auth`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add one-time link sign-in"
```

### Task 5: Books, pages and photo storage

**New concept:** S3-compatible object storage, using MinIO locally.

**Files:**
- Modify: `docker-compose.yml` (add MinIO)
- Create: `apps/api/src/photos/photo-store.ts`, `s3-photo-store.ts`, `apps/api/src/library/library.controller.ts`, `library.service.ts`
- Test: `apps/api/test/library.int-spec.ts`, `apps/api/test/helpers/memory-photo-store.ts`

**Interfaces:**
- Consumes: `SessionGuard`, `PrismaService`
- Produces: `PhotoStore { put(key: string, jpeg: Buffer): Promise<void>; get(key: string): Promise<Buffer>; delete(key: string): Promise<void> }`; `LibraryService.createPage(userId, bookId, pageNumber, jpeg): Promise<Page>`
- Routes: `GET/POST /books`, `GET/PATCH/DELETE /books/:id`, `GET/POST /books/:id/pages`, `GET /pages/:id`, `GET /pages/:id/photo`

- [ ] **Step 1: Write the failing tests**

```ts
it('creates a book with source_language ko');
it('stores an uploaded JPEG and creates a page with status UPLOADED');
it('returns 415 with a clear message for a PNG, HEIC or text file, checking file bytes');
it('returns 413 above 10 MB');
it('returns 400 when the page number is missing or below 1');
it("returns 404 for another user's book, page and photo");
it('allows two photos of the same page number');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- library`
Expected: FAIL

- [ ] **Step 3: Implement the store, service and controller**

Use `@aws-sdk/client-s3`. Name photo keys `users/{userId}/pages/{pageId}.jpg`. Do not trust the uploaded content type: check for JPEG magic bytes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- library`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml apps/api
git commit -m "feat: add books, pages and photo storage"
```

### Task 6: Redis, BullMQ and page status rules

**New concepts:** Redis, job queues, retries, and separate API and worker processes.

**Files:**
- Modify: `docker-compose.yml` (add Redis with append-only persistence), `apps/api/src/library/library.service.ts` (queue after upload)
- Create: `apps/api/src/jobs/page-status.ts`, `queues.ts`, `stuck-pages.ts`, `apps/api/src/worker.ts`
- Test: `apps/api/src/jobs/page-status.spec.ts`, `apps/api/test/jobs.int-spec.ts`

**Interfaces:**
- Produces:

```ts
type PageStatus = 'UPLOADED'|'DETECTING'|'AWAITING_CHECK'|'EXPLAINING'|'DONE'|'FAILED';
function canMove(from: PageStatus, to: PageStatus): boolean;
// Atomic update. Returns false when the page is not in the `from` status.
function movePage(db, pageId: string, from: PageStatus, to: PageStatus,
  extra?: { failedStage?: 'DETECTING'|'EXPLAINING'; failureReason?: string }): Promise<boolean>;
interface PageQueue {
  enqueueDetection(pageId: string): Promise<void>;
  enqueueExplanation(pageId: string): Promise<void>;
}
function requeueStuckPages(db, queue: PageQueue, now: Date): Promise<number>;
```

- [ ] **Step 1: Write the failing status tests**

```ts
it('allows UPLOADED→DETECTING→AWAITING_CHECK→EXPLAINING→DONE');
it('allows DETECTING→FAILED and EXPLAINING→FAILED');
it('allows FAILED→UPLOADED and FAILED→EXPLAINING for retry');
it('rejects AWAITING_CHECK→DONE and DONE→anything');
```

- [ ] **Step 2: Write the failing queue tests against real Redis using Testcontainers**

```ts
it('adding the same page twice creates one waiting job');
it('uses 3 attempts with increasing delays');
it('requeues UPLOADED, DETECTING and EXPLAINING pages unchanged for over 10 minutes');
it('does not requeue recent pages, or AWAITING_CHECK, DONE and FAILED pages');
it('saves the page as UPLOADED and still returns 201 when Redis is unavailable');
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter api test -- page-status && pnpm --filter api test:int -- jobs`
Expected: FAIL

- [ ] **Step 4: Implement status rules, queues, stuck-page check and worker**

Use job IDs `detect-{pageId}` and `explain-{pageId}` with `removeOnComplete` and `removeOnFail` set to true. Use exponential backoff starting at 5 seconds. Set `enableOfflineQueue: false` on the API's connection so Redis failures return quickly. Run `requeueStuckPages` every 5 minutes as a repeatable job.

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 3 command.
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add docker-compose.yml apps/api
git commit -m "feat: add job queue and page status rules"
```

### Task 7: Detection job, usage limits and AI budget

**Files:**
- Create: `apps/api/src/detection/detection.processor.ts`, `apps/api/src/accounts/usage.service.ts`, `apps/api/src/ai/ai-call-logger.ts`, `apps/api/src/ai/fake-ai-client.ts`
- Modify: `apps/api/src/ai/claude-ai-client.ts`, `apps/api/src/library/library.service.ts`
- Test: `apps/api/test/detection.int-spec.ts`, `apps/api/test/usage.int-spec.ts`

**Interfaces:**
- Consumes: `AiClient`, `PhotoStore`, `movePage`, `detectionResultSchema`
- Produces: `UsageService { reserve(userId: string, now: Date): Promise<void>; release(userId: string, now: Date): Promise<void>; isBudgetReached(now: Date): Promise<boolean> }`; `FakeAiClient`, which returns queued responses for tests and refuses to start when `NODE_ENV=production`

- [ ] **Step 1: Write the failing tests**

```ts
it('stores detected marks in page order and moves the page to AWAITING_CHECK');
it('keeps a mark labelled unclear as unclear');
it('moves an unusable photo to FAILED with the problem text and releases the usage');
it('replaces marks instead of duplicating them when the job runs twice');
it('moves to FAILED with failed_stage DETECTING after attempt 3 and releases the usage');
it('rejects the sixth page in a UTC day with 429 and the reset time');
it('allows pages again after the UTC day changes');
it('allows the upload and logs a warning when Redis cannot count usage');
it('pauses new pages with 503 when the cost this month reaches the budget');
it('alerts the owner once per month when the budget is reached');
it('logs model, tokens, cost and duration for every AI call');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- detection usage`
Expected: FAIL

- [ ] **Step 3: Implement the job, usage service and logger**

Count usage in Redis key `usage:{userId}:{YYYY-MM-DD}` with a 48-hour expiry. Calculate the budget by adding `ai_calls.cost` for the current UTC month. Calculate cost from `AI_INPUT_COST_PER_MTOK` and `AI_OUTPUT_COST_PER_MTOK`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- detection usage`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add detection job, usage limits and AI budget"
```

### Task 8: Mark check API

**Files:**
- Create: `apps/api/src/marks/marks.controller.ts`, `marks.service.ts`
- Test: `apps/api/test/marks.int-spec.ts`

**Interfaces:**
- Consumes: `movePage`, `PageQueue`, `SessionGuard`
- Produces routes: `GET /pages/:id/marks`, `PATCH /marks/:id`, `DELETE /marks/:id`, `POST /pages/:id/marks`, `POST /pages/:id/confirm`, `POST /pages/:id/retry`

- [ ] **Step 1: Write the failing tests**

```ts
it('changing a mark type sets source to corrected');
it('turning saving off changes an underline to underline_translate and clears normal_form');
it('turning saving on changes an underline to underline_save');
it('adding a mark sets source to added and places it last');
it('refuses edits unless the page is AWAITING_CHECK with 409');
it('refuses confirm with 409 while any mark is unclear');
it('confirm moves to EXPLAINING and queues one job');
it('a second confirm returns 409 and queues nothing');
it('confirm with no marks moves straight to DONE without an AI call');
it('retry after a detection failure re-queues detection');
it('retry after an explanation failure re-queues explanation');
it('retry on a page that is not FAILED returns 409');
it('retry needing a deleted photo returns 409 with a request to upload again');
it("returns 404 for another user's page or mark");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- marks`
Expected: FAIL

- [ ] **Step 3: Implement the controller and service**

Use `movePage` for status changes, so the database decides which of two simultaneous requests succeeds. Retrying a detection failure reserves usage again.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- marks`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add mark check API"
```

### Task 9: Explanations and the word bank

**Files:**
- Create: `apps/api/src/explanation/explanation.schema.ts`, `explanation.prompt.ts`, `explanation.processor.ts`, `apps/api/src/wordbank/normal-form.ts`, `save-results.ts`
- Test: `apps/api/src/wordbank/normal-form.spec.ts`, `apps/api/test/explanation.int-spec.ts`

**Interfaces:**
- Consumes: `AiClient`, `PhotoStore`, `movePage`, Prisma models
- Produces:

```ts
function toNormalForm(text: string): string; // NFC, trimmed, single spaces
type ExplainResult =
  | { markId: string; kind: 'translation'; translation: string }
  | { markId: string; kind: 'existing'; senseId: string; sentenceTranslation: string }
  | { markId: string; kind: 'new'; meaning: string; notes: string; example: string;
      exampleTranslation: string; sentenceTranslation: string };
function saveResults(tx, userId: string, pageId: string, results: ExplainResult[]): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('matches composed and decomposed Korean as the same normal form', () => {
  expect(toNormalForm('사과'.normalize('NFD'))).toBe(toNormalForm('사과'));
});
it('collapses extra spaces in a grammar pattern');

it('creates an item, sense, sighting and card for a new underline_save mark');
it('creates a grammar item for a curly mark');
it('creates a translation and no item or card for an underline_translate mark');
it('adds a sighting and no card when the model says the meaning is the same');
it('adds a new sense and card to the item when the meaning differs');
it('sends existing senses for that normal form to the model');
it('creates one item, sense and card when a word is marked twice on a page');
it('handles a curly or added word mark inside an underlined sentence as two separate results');
it('resolves normal_form and sentence from the photo for added and retyped marks');
it('treats a result with a missing mark ID or an unknown sense ID as invalid output');
it('creates no duplicates when the job runs twice');
it('rolls back everything if saving fails partway');
it('moves to DONE after saving, and to FAILED with failed_stage EXPLAINING after attempt 3');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test -- normal-form && pnpm --filter api test:int -- explanation`
Expected: FAIL

- [ ] **Step 3: Implement the job and `saveResults`**

Order of work:
1. For a word or grammar mark without `normal_form`, make a `resolve` AI call using the photo. If the sentence cannot be found, use the marked text as the sentence.
2. Look up existing senses by normal form.
3. Make the `explain` call with the fields in spec section 6.2, written in English at TOPIK 3–4 level.
4. Save all results in one transaction.

Within one transaction, reuse a new sense when another result on the page has the same normal form and meaning. The word's first sighting is used for its card.

- [ ] **Step 4: Run the tests to verify they pass**

Run the Step 2 command.
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add explanations and word bank saving"
```

### Task 10: Results, word bank and review APIs

**Files:**
- Create: `apps/api/src/review/scheduler.ts`, `review.controller.ts`, `review.service.ts`, `apps/api/src/wordbank/wordbank.controller.ts`, `wordbank.service.ts`, `apps/api/src/library/results.service.ts`
- Test: `apps/api/src/review/scheduler.spec.ts`, `apps/api/test/wordbank.int-spec.ts`, `apps/api/test/review.int-spec.ts`

**Interfaces:**
- Produces:

```ts
type Rating = 'again' | 'hard' | 'easy';
interface CardState { intervalDays: number; ease: number; }
function schedule(card: CardState, rating: Rating, now: Date): CardState & { dueAt: Date };
```

- Routes: `GET /pages/:id/results`, `GET /wordbank?q=&kind=`, `GET/PATCH/DELETE /wordbank/:id`, `GET /review/due`, `POST /review/:cardId`

- [ ] **Step 1: Write the failing scheduler tests with the exact values**

```ts
const now = new Date('2026-01-01T00:00:00Z');
it('Again resets the interval and repeats in 10 minutes', () => {
  expect(schedule({ intervalDays: 10, ease: 2.5 }, 'again', now))
    .toEqual({ intervalDays: 0, ease: 2.3, dueAt: new Date('2026-01-01T00:10:00Z') });
});
it('Hard on a new card gives 1 day and lowers ease by 0.15');
it('Hard on a reviewed card multiplies the interval by 1.2, rounded up');
it('Easy on a new card gives 3 days and raises ease by 0.05');
it('Easy on a reviewed card multiplies the interval by ease, rounded');
it('ease never goes below 1.3');
```

- [ ] **Step 2: Write the failing API tests**

```ts
it('returns results in mark order for all three kinds');
it('includes "seen before" with book, page and sentence on a repeated item');
it('returns 409 for results before the page is DONE');
it('searches the word bank by normal form and meaning');
it('lists every sighting of an item');
it('edits a sense meaning and notes');
it('deleting an item removes its senses, sightings and cards');
it('returns only cards due now, oldest first');
it('returns the sentence and the text to highlight on the card front');
it('returns the highlight as null when the text is not found in the sentence');
it('rejects a rating other than again, hard or easy with 400');
it("returns 404 for another user's item, page or card");
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter api test -- scheduler && pnpm --filter api test:int -- wordbank review`
Expected: FAIL

- [ ] **Step 4: Implement the scheduler, services and controllers**

- [ ] **Step 5: Run the tests to verify they pass**

Run the Step 3 command.
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/api
git commit -m "feat: add results, word bank and review APIs"
```

### Task 11: Photo retention and account deletion

**Files:**
- Create: `apps/api/src/photos/photo-retention.ts`, `apps/api/src/accounts/account.service.ts`
- Modify: `apps/api/src/worker.ts`, `apps/api/src/library/library.controller.ts`, `apps/api/src/accounts/auth.controller.ts`
- Test: `apps/api/test/retention.int-spec.ts`

**Interfaces:**
- Consumes: `PhotoStore`, `PrismaService`
- Produces: `deleteExpiredPhotos(db, store, now: Date): Promise<number>`
- Routes: `DELETE /pages/:id/photo`, `DELETE /account`

- [ ] **Step 1: Write the failing tests**

```ts
it('deletes photos on pages unchanged for over 30 days, whatever their status');
it('keeps newer photos');
it('sets photo_deleted_at and keeps results and word bank entries');
it('retries a storage failure on the next run');
it('deletes one photo on request');
it('DELETE /account removes all user rows and photos, and ends the session');
it("returns 404 for another user's page");
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- retention`
Expected: FAIL

- [ ] **Step 3: Implement retention and deletion**

Run retention as a daily repeatable job. Delete from storage before setting `photo_deleted_at`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- retention`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api
git commit -m "feat: add photo retention and account deletion"
```

### Task 12: Web app: sign-in, capture and Mark check

**Files:**
- Create: `apps/web/` (Vite, React, TypeScript), `apps/web/src/api.ts`, `photo.ts`, `pages/SignIn.tsx`, `Books.tsx`, `Capture.tsx`, `MarkCheck.tsx`
- Test: `apps/web/src/photo.spec.ts`, `apps/web/src/pages/MarkCheck.spec.tsx`

**Interfaces:**
- Consumes: routes from Tasks 4, 5 and 8; the Mark check view from `docs/stage-0-results.md`
- Produces: `preparePhoto(file: File): Promise<Blob>`, returning a JPEG with a longest edge of at most 2000 px and quality 0.85

- [ ] **Step 1: Write the failing tests**

```ts
it('shrinks a large image to a 2000 px longest edge and outputs JPEG');
it('does not enlarge a small image');
it('shows a clear error when the browser cannot read the file');
it('disables Confirm while any mark is unclear');
it('changes a mark type when tapped');
it('shows a save switch on every underline and none on curly marks');
it('adds a typed mark with the chosen type');
it('shows the retake message when the page failed as unusable');
it('shows Retry on any other failed page');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test`
Expected: FAIL

- [ ] **Step 3: Implement the screens**

Design for a phone first. Capture uses `<input type="file" accept="image/*">`, not a live camera view. Poll `GET /pages/:id` every 2 seconds during processing. Always show the mark list. Draw colour-coded highlights on the photo only if Task 2 chose `highlights`. Use `frontend-design` guidance for the visual style.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add sign-in, capture and Mark check screens"
```

### Task 13: Web app: results, word bank and review

**Files:**
- Create: `apps/web/src/pages/Results.tsx`, `WordBank.tsx`, `Review.tsx`, `Settings.tsx`
- Test: `apps/web/src/pages/Results.spec.tsx`, `Review.spec.tsx`, `WordBank.spec.tsx`

**Interfaces:**
- Consumes: routes from Tasks 10 and 11

- [ ] **Step 1: Write the failing tests**

```ts
it('shows word, grammar and translation results in mark order');
it('shows "You saw this on page 12" with the earlier sentence');
it('shows the front of a card first, and the back and ratings after a tap');
it('offers exactly Again, Hard and Easy');
it('shows an empty message when nothing is due');
it('shows the sentence without highlighting when highlight is null');
it('asks for confirmation before deleting an item or the account');
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter web test`
Expected: FAIL

- [ ] **Step 3: Implement the screens**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter web test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "feat: add results, word bank and review screens"
```

### Task 14: End-to-end test, containers and deployment

**New concept:** building images and running the system in production.

**Files:**
- Create: `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/api/src/health/health.controller.ts`, `e2e/journey.spec.ts`, `playwright.config.ts`, `docs/deployment.md`
- Modify: `docker-compose.yml` (add `api`, `worker` and `web`), `.env.example`

**Interfaces:**
- Consumes: everything above
- Produces: `GET /health`, which reports PostgreSQL and Redis status

- [ ] **Step 1: Write the failing end-to-end test**

```ts
test('full journey with the fake AI client', async ({ page }) => {
  // sign in → create a book → upload a page → resolve an unclear mark → confirm
  // → see all three result kinds → review a card as Easy
  // → upload a second page repeating the word → see "You saw this on page"
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `docker compose up -d --build && pnpm exec playwright test`
Expected: FAIL because the images and health route do not exist.

- [ ] **Step 3: Write the Dockerfiles and health route**

Use multi-stage builds with a non-root user. The same API image starts either `main.js` or `worker.js`. Run Prisma migrations as a release step, not at process start.

- [ ] **Step 4: Run the test to verify it passes**

Run the Step 2 command with `AI_PROVIDER=fake`.
Expected: PASS

- [ ] **Step 5: Create the hosted services and enter the secrets**

The founder creates the Railway, Cloudflare R2, SMTP and Anthropic accounts and enters all keys in the hosting dashboard. Keys are never pasted into chat or committed.

- [ ] **Step 6: Deploy and check**

Run: `curl https://<app-domain>/health`
Expected: PostgreSQL and Redis are both reported as healthy.

- [ ] **Step 7: Test on real devices**

On a real iPhone and Android phone, sign in, take a photo, upload it and complete a page. Confirm the camera opens and the AI cost appears in `ai_calls`. Record the results in `docs/deployment.md`.

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "feat: add containers, end-to-end test and deployment"
```

### Stage 1 exit check

This is not a coding task. The founder uses the deployed app with real books for 3 weeks.

- **Pass:** the founder no longer goes back to the Claude project. Next, plan Stage 2.
- **Also check:** detection accuracy from corrected marks, and cost per page from `ai_calls`.
