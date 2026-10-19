# Deploying as a website (graphics-only, no server to manage)

This puts Broadcast Studio on the internet at a normal web address. Scorers, operators and producers just open
the link in a browser. Nobody installs anything.

**Graphics-only** means everything except cloud video: scoring (including the offline scorer app), the control
room, overlays, themes, automation, sponsors, reports and the media library (uploads, exports). You stream with
**OBS on your own computer**: add an overlay's *Production URL* as a Browser Source, put it over your camera and
stream to YouTube/Facebook/Twitch from OBS. Cloud streaming, recordings and automatic live highlights are turned
off in this mode (they need a media server; see `docs/operations.md`).

The guide uses **Railway** (one app service plus its Postgres and Redis), **Cloudflare R2** for files and
**Resend** (or any SMTP provider) for email. Any platform that runs a Dockerfile works the same way.

## What it costs (roughly)

| Part | Provider | Monthly |
| --- | --- | --- |
| App (web, API, workers in one container) | Railway | ~$5–20, usage based |
| PostgreSQL + Redis | Railway | included in the usage above, ~$5–10 |
| File storage | Cloudflare R2 | free up to 10 GB |
| Email | Resend | free up to 3,000 emails |

## 1. File storage (Cloudflare R2)

1. Cloudflare dashboard → **R2** → *Create bucket*, e.g. `broadcast-studio`. Leave public access **off**.
2. R2 → *Manage API tokens* → *Create API token* with **Object Read & Write** on that bucket.
3. Note the **Access Key ID**, **Secret Access Key** and the **S3 endpoint**
   (`https://<account-id>.r2.cloudflarestorage.com`).

## 2. Email (Resend or another SMTP provider)

Sign-up verification and password resets are sent by email, so this is required.
Resend → *Domains* → add and verify your domain → *API keys* → create one. SMTP settings: host `smtp.resend.com`,
port `465`, secure `true`, user `resend`, password = the API key.

## 3. Railway

1. Sign in to Railway with GitHub → **New project** → **Deploy from GitHub repo** → choose this repository.
   It finds `railway.json` and builds `infra/Dockerfile`.
2. In the same project: **+ Create** → **Database** → **PostgreSQL**, then again for **Redis**.
3. Open the app service → **Settings → Networking → Generate domain** (or add your own domain).
4. Generate the secrets. On any computer with Node 22: `node scripts/gen-secrets.mjs`. It prints five lines;
   any long random strings work if you'd rather make them yourself (`ENCRYPTION_KEY` must be 32 random bytes,
   base64-encoded).
5. App service → **Variables** → **Raw editor**, paste and fill in:

```env
NODE_ENV=production
STREAMING_ENABLED=false
MIGRATE_ON_START=true

# from scripts/gen-secrets.mjs
DB_APP_PASSWORD=...
DB_WORKER_PASSWORD=...
BETTER_AUTH_SECRET=...
MEDIA_TOKEN_SECRET=...
ENCRYPTION_KEY=...

# database: Railway fills in the ${{...}} references
DATABASE_ADMIN_URL=${{Postgres.DATABASE_URL}}
DATABASE_URL=postgres://bs_app:${{DB_APP_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
DATABASE_WORKER_URL=postgres://bs_worker:${{DB_WORKER_PASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}
REDIS_URL=${{Redis.REDIS_URL}}

# Cloudflare R2
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=broadcast-studio
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true

# email
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=resend
SMTP_PASSWORD=...
MAIL_FROM="Your Studio <no-reply@yourdomain.com>"

# optional: branding and defaults
PRODUCT_NAME=Broadcast Studio
DEFAULT_TIMEZONE=Australia/Brisbane
```

The public address is picked up from Railway's generated domain automatically. **If you use your own domain**,
also set `PUBLIC_WEB_URL=https://studio.yourdomain.com`. Do not set `PUBLIC_REALTIME_URL`: left empty, live
updates use the site's own address.

6. **Deploy.** On start the container applies database migrations (`MIGRATE_ON_START=true`), then runs the web
   app, API and workers behind one port. Railway waits for `/api/v1/health/ready` before sending traffic; it
   reports `"media": "disabled"` in this mode.

## 4. First sign-in

Open your address → **Create account** → confirm the email → name your organisation. You are its owner.
Invite your team from **Settings → Members** (each person gets an email link).

## Updating

Push to the branch Railway deploys from. It rebuilds, migrates and restarts by itself.

## Backups

Railway Postgres → *Backups* (enable scheduled backups). R2 keeps files durably; for a second copy, see
`docs/operations.md#backups-and-restore`. Keep a copy of `ENCRYPTION_KEY` somewhere safe: without it, encrypted
values in the database cannot be read.

## Other platforms

Any host that builds a Dockerfile and gives you one port works: build `infra/Dockerfile` (its default command is
`node scripts/start-hosted.mjs`, which listens on `$PORT`), add Postgres and Redis, and set the variables above
with that platform's connection strings. On Render, `RENDER_EXTERNAL_URL` is picked up the way Railway's domain is.
The Postgres user in `DATABASE_ADMIN_URL` must be allowed to create roles (migrations create `bs_app` and
`bs_worker`).

## Turning streaming on later

Move to a server with dedicated CPU (see `docs/operations.md`), run LiveKit (`pnpm services:up`), set
`STREAMING_ENABLED=true` with the `LIVEKIT_*` and `PUBLIC_*` media settings, and the Streams pages reappear.
