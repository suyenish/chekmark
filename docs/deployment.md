# Deploying Chekmark

How the app runs in production, and the steps to put it online. Stage 1 is a personal version: one reader (you), a small allowlist, and a monthly AI budget.

## What runs where

| Part | Runs as | Where |
|---|---|---|
| Web app | `apps/web/Dockerfile` (nginx, non-root, port 8080). Serves the screens and forwards `/api` to the API | Railway service `web`, the only public one |
| API | `apps/api/Dockerfile`, `node dist/main.js` (port 3000) | Railway service `api`, private |
| Worker | The same image, `node dist/worker.js` | Railway service `worker`, private |
| Migrations | The same image, `npx prisma migrate deploy` | Pre-deploy command of `api` |
| PostgreSQL, Redis | Railway databases | Railway |
| Photos | S3-compatible storage | Cloudflare R2 |
| Sign-in email | Resend API, or SMTP | Railway's Hobby plan blocks SMTP ports |
| AI | Claude API | Anthropic |

Because the web server forwards `/api` on the same domain, the session cookie is first-party and no CORS setup is needed.

## Keys and secrets

Enter every key only in the Railway dashboard (or your local `.env`). Never paste a key into a chat, an issue or a commit. If a key is ever exposed, revoke it at the provider and create a new one.

## Step 1: create the accounts

Check each provider's current pricing and free allowance when you sign up; prices change.

1. **Railway** (railway.com): sign in with GitHub and allow access to the `suyenish/chekmark` repository.
2. **Cloudflare R2**: create a bucket named `chekmark-photos` (private; no public access). Create an R2 API token with *Object Read & Write* for that bucket only. Note the account's S3 endpoint, `https://<account-id>.r2.cloudflarestorage.com`.
3. **Email**: for Stage 1, Resend works without your own domain: from `onboarding@resend.dev` it can send only to the address you signed up with, which is enough for one reader. Create an API key. For other readers later, verify a domain.
4. **Anthropic**: create an API key for production (separate from the one on your laptop), and set a monthly spend limit in the console as a second safety net next to the app's own budget.

## Step 2: create the Railway project

In one Railway project:

1. **Add PostgreSQL** and **Add Redis** (Database → PostgreSQL / Redis).
2. **Add a service from the GitHub repo** three times, named `api`, `worker` and `web`. Keep the root directory as the repository root for all three: the Dockerfiles need the whole repository.

### Variables for `api` and `worker`

Set the same variables on both (Railway's shared variables make this easier):

| Variable | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `apps/api/Dockerfile` |
| `NODE_ENV` | `production` |
| `PORT` | `3000` (api only) |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}?family=0`. The `family=0` lets the Redis client use Railway's IPv6 private network; without it the worker cannot connect |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `chekmark-photos` |
| `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | from the R2 token |
| `ANTHROPIC_API_KEY` | your production key |
| `AI_MODEL` | `claude-haiku-5-5` |
| `AI_INPUT_COST_PER_MTOK`, `AI_OUTPUT_COST_PER_MTOK` | `0.1`, `0.5` (check current Haiku prices) |
| `AI_MONTHLY_BUDGET_USD` | `20` |
| `DAILY_PAGE_LIMIT` | `5` |
| `SIGN_UP` | `allowlist` (only `ALLOWED_EMAILS` can sign in) or `open` (anyone with an email address). Start with `allowlist` |
| `ALLOWED_EMAILS` | your email, and anyone you invite, separated by commas |
| `OWNER_EMAIL` | your email (gets the budget alert) |
| `APP_URL` | the web service's public URL, for example `https://chekmark.up.railway.app`. It must match the address in the browser exactly: sign-in links point to it, and requests from any other site are refused |
| `RESEND_API_KEY` | your Resend API key (`re_...`). Railway's Hobby plan blocks SMTP, so use this instead of `SMTP_URL` there |
| `MAIL_FROM` | `Chekmark <onboarding@resend.dev>` |

Leave `AI_PROVIDER` unset: the app refuses `fake` in production.

### Opening sign-up to everyone

`SIGN_UP=open` lets any address sign in. Before you switch it on:

- Resend's `onboarding@resend.dev` sender only reaches your own address. To email other people, verify your own domain with your email provider and set `MAIL_FROM` to an address on it.
- Check the three cost controls: `DAILY_PAGE_LIMIT` (pages per reader per day), `AI_MONTHLY_BUDGET_USD` (the whole app pauses new pages when it is reached, and `OWNER_EMAIL` is told once), and the spend limit in the Anthropic console.
- Read the privacy page at `/privacy` and change anything that is not true for how you run the app.
- Use your own domain rather than the shared `up.railway.app` one.

The app limits sign-in links to 5 per address in 15 minutes and 300 an hour in total, so the form cannot be used to flood an inbox.

### Commands

- `api`: start command `node dist/main.js`; **pre-deploy command** `npx prisma migrate deploy`; health check path `/health`.
- `worker`: start command `node dist/worker.js`; no public domain.

### `web`

| Variable | Value |
|---|---|
| `RAILWAY_DOCKERFILE_PATH` | `apps/web/Dockerfile` |
| `API_UPSTREAM` | `api.railway.internal:3000` |

Generate a public domain for `web` (Settings → Networking) with target port **8080**. Put that URL in `APP_URL` on `api` and `worker`, and redeploy them.

## Step 3: deploy and check

1. Deploy `api` first (its pre-deploy step creates the tables), then `worker` and `web`.
2. Check the health route through the public domain:

   ```bash
   curl https://<your-web-domain>/api/health
   ```

   Expected: `{"status":"ok","postgres":"up","redis":"up"}`.
3. Open the site, sign in with your email, and check the link arrives. If it does not: the `api` log says at start whether the email server is reachable ("Email server is reachable" or "Cannot reach the email server"), and the sign-in screen says so when an email could not be sent.

4. Redeploy `api` on its own, wait for it to finish, and run the `curl` again. It should still answer `ok`: the web server looks the API up every 10 seconds, so it follows a redeployed API to its new address without a restart.

If `/api/health` answers 502, `web` cannot reach `api`: check `API_UPSTREAM`, and that `api` has `PORT=3000`. A 502 for a few seconds while `api` restarts is expected.

## Step 4: test on real phones

On an iPhone and an Android phone: sign in, create a book, tap **Take or choose a photo** and confirm the camera opens, upload a marked page, finish the Mark check, read the results, and review a card. Then check the cost appeared:

```sql
select purpose, model, input_tokens, output_tokens, cost, created_at from ai_calls order by created_at desc limit 5;
```

(Railway → Postgres → Data, or `railway connect Postgres`.)

Record what you found:

| Phone | Browser | Camera opened | Upload | Mark check | Results | Review | Notes |
|---|---|---|---|---|---|---|---|
| iPhone | Safari | | | | | | |
| Android | Chrome | | | | | | |

## Running the whole app locally

```bash
docker compose --profile app up -d --build
```

The app is at http://localhost:8080. Any address can sign in there, and because no email service is set, the sign-in screen shows the link itself. To try it without calling Claude, start it with `AI_PROVIDER=fake` in front.

## The end-to-end test

It drives a phone-sized browser through the whole journey against the containers, using the fake AI:

```bash
AI_PROVIDER=fake docker compose --profile app up -d --build
pnpm e2e
```

It signs in with a new `e2e-…@example.com` address each run, deletes that account at the end, and leaves nothing behind. GitHub Actions runs it, with every other test, on each push (`.github/workflows/ci.yml`).

## Stage 1 exit check

Use the deployed app with real books for 3 weeks. It passes when you no longer go back to the Claude project. Also check detection accuracy (marks with `source = 'corrected'` or `'added'` against `'detected'`) and the cost per page in `ai_calls`.
