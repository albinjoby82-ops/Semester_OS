# Deploying Semester OS

Semester OS is a Cloudflare Worker with a Cloudflare D1 database. The app is
installable as a PWA after it is served over HTTPS.

## One-time Cloudflare setup

Log in to the Cloudflare account that will own the app, then create its
production database:

```powershell
npx wrangler login
npx wrangler d1 create semester-os
```

Copy the returned `database_id` into `wrangler.jsonc`, replacing
`local-dev-placeholder`. The `npm run deploy` command intentionally refuses to
run until this is done.

Apply the schema and populate the initial modules and areas:

```powershell
npm run db:migrate:remote
npm run db:seed:generate
npx wrangler d1 execute semester-os --remote --file db/seed/seed.sql
```

## Secrets

The app can run without Google or WhatsApp integrations. Set `SESSION_SECRET`
before the first deployment, and add the optional secrets only for the
integrations you intend to use:

```powershell
npx wrangler secret put SESSION_SECRET
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REDIRECT_URI
```

When configuring Google, the redirect URI must exactly match:

```text
https://YOUR_WORKER_DOMAIN/api/google/callback
```

## Privacy before launch

This is currently a single-user app with no built-in account system. Do not
publish it openly with personal data. Protect the Worker using Cloudflare
Access, or add application authentication, before sharing the URL with anyone.

## Deploy and verify

```powershell
npm run deploy
```

After deployment, verify `/api/health`, a refreshed deep link such as
`/glance`, offline capture, installed-PWA launch, and (if enabled) a Google
Calendar connection. The Worker’s nightly schedule refreshes the connected
Calendar mirror automatically.

## Backing up local data

Running locally, the database lives in `.wrangler/state` and is not backed up
by anything. Most of it can be rebuilt -- modules and assignments from
`npm run db:seed:local`, calendar events by pressing Fetch -- but grades and
time sessions cannot. They record what actually happened and have no source of
truth anywhere else.

```
npm run db:backup
```

Writes a timestamped data-only snapshot to `backups/`, keeping the last ten.
`backups/` is gitignored: these files contain personal data and must not be
committed.

```
npm run db:restore -- backups/<file>.sql
```

Drops every table, reapplies the migrations, and reloads the snapshot. It takes
its own backup first, so restoring the wrong file is recoverable.

Snapshots hold data only. The schema comes from `db/migrations`, which is the
authoritative copy and, unlike a full dump, applies in an order SQLite accepts.
