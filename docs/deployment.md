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

1. **Railway** (railway.com): sign in with GitHub and allow access to the `suyenish/chekmark` repository. The trial ends after a set time or credit; move to the Hobby plan before it does, or the app stops.
2. **Cloudflare R2**: create a bucket named `chekmark-photos` (private; no public access). Create an R2 API token with *Object Read & Write* for that bucket only. Note the account's S3 endpoint, `https://<account-id>.r2.cloudflarestorage.com`.
3. **Email**: create a Resend API key (`re_...`). Without your own domain, Resend's `onboarding@resend.dev` sender reaches only the address you signed up with; any other address is refused with a 403 ("You can only send testing emails to your own email address"). To email other readers, verify a domain: see *Your own domain* below.
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
| `AI_MODEL` | `claude-haiku-5-5`. Required in production, so the model always matches the two prices below |
| `AI_INPUT_COST_PER_MTOK`, `AI_OUTPUT_COST_PER_MTOK` | `0.1`, `0.5` (check current Haiku prices) |
| `AI_MONTHLY_BUDGET_USD` | `20` |
| `DAILY_PAGE_LIMIT` | `5` |
| `SIGN_UP` | `allowlist` (only `ALLOWED_EMAILS` can sign in) or `open` (anyone with an email address). Start with `allowlist` |
| `DEMO` | `on` shows **Try the demo** on the sign-in screen: a temporary account with sample pages, deleted after 24 hours, at most 60 new ones an hour. Demo accounts cannot upload and never call Claude. Off by default; set it on both `api` and `worker` |
| `ALLOWED_EMAILS` | your email, and anyone you invite, separated by commas |
| `OWNER_EMAIL` | your email (gets the budget alert) |
| `APP_URL` | the web service's public URL, for example `https://chekmark.up.railway.app`. It must match the address in the browser exactly: sign-in links point to it, and requests from any other site are refused |
| `RESEND_API_KEY` | your Resend API key (`re_...`). Railway's Hobby plan blocks SMTP, so use this instead of `SMTP_URL` there |
| `MAIL_FROM` | `Chekmark <onboarding@resend.dev>`, or an address on your verified sending domain, such as `Chekmark <no-reply@mail.chekmark.app>` |

Leave `AI_PROVIDER` unset: the app refuses `fake` in production.

### Opening sign-up to everyone

`SIGN_UP=open` lets any address sign in. Before you switch it on:

- Resend's `onboarding@resend.dev` sender only reaches your own address. To email other people, verify your own domain with your email provider and set `MAIL_FROM` to an address on it.
- Check the three cost controls: `DAILY_PAGE_LIMIT` (pages per reader per day), `AI_MONTHLY_BUDGET_USD` (the whole app pauses new pages when it is reached, and `OWNER_EMAIL` is told once), and the spend limit in the Anthropic console.
- Read the privacy page at `/privacy` and change anything that is not true for how you run the app.
- Use your own domain rather than the shared `up.railway.app` one.

The app limits sign-in links to 5 per address in 15 minutes and 300 an hour in total, so the form cannot be used to flood an inbox.

### Commands

- `api`: start command `node dist/main.js` (or empty); **pre-deploy command** `npx prisma migrate deploy`; health check path `/health`.
- `worker`: start command `node dist/worker.js`; no public domain.
- `web`: **no** custom start command and **no** custom build command. Its image is nginx and has no `pnpm`; a command such as `pnpm --filter web dev` (which Railway may fill in from the workspace) fails with "The executable `pnpm` could not be found".

None of the three needs pnpm in a command: everything is built inside the Dockerfiles. A custom command typed into a settings box is only saved after you apply the staged change (the purple *Deploy* bar).

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
3. Open the site, sign in with your email, and check the link arrives. If it does not:
   - The sign-in screen says so when an email could not be sent, and the `api` log has the reason, for example `Resend refused the email (400): API key is invalid` or `(403): You can only send testing emails to your own email address`.
   - The `api` log says at start how it sends: "Sign-in links will be emailed through the Resend API", or for SMTP "Email server is reachable" / "Cannot reach the email server". On Railway's Hobby plan SMTP always times out: use `RESEND_API_KEY`.
   - An address that is not in `ALLOWED_EMAILS` gets the same "check your email" screen but no email, on purpose, and nothing is logged.
   - If pages stay unread, the `worker` log shows `401 ... invalid x-api-key` when `ANTHROPIC_API_KEY` is wrong.

   When you paste a key into Railway, paste only the key itself: no quotes, spaces or line breaks, and not the whole `smtps://…` address it may have come from. After changing a variable, apply the staged change so the services redeploy.

4. Redeploy `api` on its own, wait for it to finish, and run the `curl` again. It should still answer `ok`: the web server looks the API up every 10 seconds, so it follows a redeployed API to its new address without a restart.

If `/api/health` answers 502, `web` cannot reach `api`: check `API_UPSTREAM`, and that `api` has `PORT=3000`. A 502 for a few seconds while `api` restarts is expected.

## Your own domain

The steps below use `chekmark.app`, bought on Cloudflare, so Cloudflare holds its DNS.

### Sending email from it (Resend)

1. In Resend → Domains, add a sending subdomain such as `mail.chekmark.app`. Keep *Enable Sending* on, add the recommended DMARC record, and leave *Enable Receiving* off: the app never receives email.
2. Add every record Resend lists in Cloudflare → DNS (or let Resend configure Cloudflare for you): the DKIM TXT record, the SPF records (CNAME and/or MX, TXT) and DMARC (`_dmarc`, `v=DMARC1; p=none;`). Set any CNAME to **DNS only**: mail records do not work through Cloudflare's proxy.
3. When Resend shows the domain as *Verified*, set `MAIL_FROM` to an address on it, for example `Chekmark <no-reply@mail.chekmark.app>`, and redeploy. Now any address in `ALLOWED_EMAILS` gets its link.

### Serving the app on it (Railway)

1. Railway → `web` → Settings → Networking → *Custom Domain*: add `chekmark.app` (port 8080).
2. Add the records Railway shows in Cloudflare DNS: a CNAME for `@` and, if shown, a `_railway-verify` TXT. Keep the CNAME **DNS only**, so Railway can issue the HTTPS certificate (`.app` domains only work over HTTPS).
3. When Railway shows the domain as ready, set `APP_URL=https://chekmark.app` (no trailing slash) and redeploy. From then on only that address works for signing in and uploading; the old `up.railway.app` address can still be opened but its actions are refused.

### Sending `www` to the bare domain

Do not add `www.chekmark.app` to Railway: its requests would come from a different address than `APP_URL` and be refused. Redirect it at Cloudflare instead:

1. DNS: a CNAME `www` → `chekmark.app`, **Proxied** (the redirect runs on Cloudflare, so the request never reaches Railway).
2. Rules → Redirect Rules: the *Redirect from WWW to root* template, or hostname equals `www.chekmark.app` → dynamic `concat("https://chekmark.app", http.request.uri.path)`, status 301, keep the query string.

A device that looked up `www` before the record existed may remember "not found" for up to an hour; turning Airplane Mode on and off clears it on a phone.

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
