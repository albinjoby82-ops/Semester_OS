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

## Backing up

There are two unrelated databases: the local one in `.wrangler/state`, and the
deployed one behind the Worker. Neither is backed up by anything. Most of it can be rebuilt -- modules and assignments from
`npm run db:seed:local`, calendar events by pressing Fetch -- but grades and
time sessions cannot. They record what actually happened and have no source of
truth anywhere else.

```
npm run db:backup
```

Writes a timestamped data-only snapshot to `backups/local/`, keeping the last
ten. Add `:remote` to snapshot the deployed database into `backups/remote/`
instead. `backups/` is gitignored: these files contain personal data and must
not be committed.

```
npm run db:restore -- backups/local/<file>.sql
```

Drops every table, reapplies the migrations, and reloads the snapshot. It takes
its own backup first, so restoring the wrong file is recoverable. **Stop the dev
server before restoring locally** -- it holds the database open, and the restore
fails partway with an error that does not say so.

Restoring the deployed database needs `db:restore:remote` and an explicit
`--yes`, because it overwrites live data that is not on this machine. A snapshot
from the other environment is refused unless you also pass `--force`.

Snapshots hold data only. The schema comes from `db/migrations`, which is the
authoritative copy and, unlike a full dump, applies in an order SQLite accepts.
