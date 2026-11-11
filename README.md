# Chekmark (책마크)

Read a real Korean book, mark it with a pencil, and your marks become your study material.

Chekmark is a phone-first web app. You underline words, draw a wavy line under grammar, or underline a whole sentence, then take a photo of the page. The app reads your marks with Claude, lets you check them, explains each one in English, and turns the words and grammar into flashcards built from sentences in your own book.

**Status:** beta. Mark reading is about 65–75% accurate on the first test pages ([results](docs/stage-0-results.md)), so every page goes through a Mark check before anything is saved.

## How it works

1. **Sign in** with a one-time email link. No password.
2. **Add a page:** the page number and one photo. The browser shrinks the photo before upload.
3. **Mark check:** the app lists the marks it found. You fix the kind or the text, remove wrong ones, add missed ones, and confirm.
4. **Results:** the meaning in context, a usage note, your sentence with a translation, and an example. A word you have met before shows where you saw it.
5. **Review:** flashcards with your own sentence on the front, scheduled with an SM-2 style algorithm.

## What it is built with

| Part | Technology |
|---|---|
| API and worker | NestJS 12, TypeScript, one codebase started as two processes |
| Database | PostgreSQL with Prisma 7 |
| Job queue | BullMQ on Redis: retries, a stuck-page check, daily clean-up |
| Photos | S3-compatible storage (SeaweedFS locally, Cloudflare R2 in production) |
| AI | Claude (Haiku) with structured output checked against a schema |
| Web app | React 19, Vite, React Router, the [Astryx](https://github.com/meta/astryx) design system with a custom theme |
| Tests | Vitest, Testcontainers (real PostgreSQL, Redis, storage and mail server), Playwright end to end |
| Running it | Docker images for the API/worker and the web server (nginx) |

Things worth reading in the code:

- [`apps/api/src/jobs/page-status.ts`](apps/api/src/jobs/page-status.ts): every page moves through a small state machine with atomic updates, so a double tap cannot queue two jobs.
- [`apps/api/src/wordbank/save-results.ts`](apps/api/src/wordbank/save-results.ts): a page's explanations are saved in one transaction and are safe to run twice.
- [`apps/api/src/accounts/`](apps/api/src/accounts): passwordless sign-in with hashed tokens, a link limit, a daily page limit and a monthly AI budget.
- [`docs/stage-1-decisions.md`](docs/stage-1-decisions.md): every decision made while building, with what it costs if it was wrong.

## Run it on your computer

You need Node 24, Docker, and pnpm through corepack.

```bash
corepack pnpm install
cp .env.example .env        # then put your Anthropic API key in .env
docker compose --profile app up -d --build
```

Open http://localhost:8080. Enter any email address: with no email service set up, the sign-in screen shows the link itself.

To try it without an API key, start it with the scripted fake AI:

```bash
AI_PROVIDER=fake docker compose --profile app up -d --build
```

## Develop

```bash
docker compose up -d                          # PostgreSQL, Redis and photo storage
cd apps/api && corepack pnpm db:deploy        # create the tables
corepack pnpm start:dev                       # API on :3000
corepack pnpm start:worker                    # worker, in a second terminal
cd ../web && corepack pnpm dev                # web app on :5173
```

## Test

```bash
cd apps/api && corepack pnpm test             # unit tests
corepack pnpm test:int                        # integration tests (needs Docker)
cd ../web && corepack pnpm test               # web app tests
cd ../.. && corepack pnpm e2e                 # the whole journey, against the Docker stack started with AI_PROVIDER=fake
```

## Deploy

See [docs/deployment.md](docs/deployment.md) for Railway, Cloudflare R2, email and the settings that matter in production.

## Privacy

Photos are private to their reader and deleted after 30 days. Only the marked text and its sentence are kept, never the full page. Readers can delete a photo or their whole account at any time. The app's privacy page (`/privacy`) says this in plain words.
