# Production deployment: API next to PostgreSQL

Target layout (not deployed yet; CI/CD below is implemented on
`feature/m2-server`, not active until merged to `main` and configured):

```
Browser ── https://commissaire.us ──────────► GitHub Pages (React PWA, unchanged)
   │
   └──── https://api.commissaire.us ──► Nginx :443 ──► Node API 127.0.0.1:4000 ──► PostgreSQL 127.0.0.1:5432
                                       (same Linux server, beside El Niño)          (Commissaire's own database)
```

Nothing here changes El Niño: not its database, role, service, or Nginx files.
Commissaire gets its own Nginx file, its own service, its own `.env`.

Database `commissaire`, login role `commissaire_app` (the database 001–008 were run on).

## Database connection: loopback, no TLS needed

The API connects to `127.0.0.1`, never to the public database host name.

- **Why this is secure without TLS:** loopback traffic never leaves the
  server's kernel, so there is nothing on the network to read or tamper with.
  The password is still checked (`scram-sha-256`), so authentication is not
  weakened.
- **What the code enforces** (`src/db/tls.ts`, `src/config/env.ts`):
  - A loopback host (`127.0.0.1`, `localhost`, `::1`) uses no TLS unless the
    URL asks for it with `sslmode=require`, `verify-ca` or `verify-full`.
  - Any other host always uses TLS with full certificate verification
    (`docs/server/database.md`, Setup step 5).
  - In production, `DEV_PGLITE` stops the API at start, so a loopback database
    is never migrated by code. Migrations stay manual.
  - Tests use their own in-memory database and refuse to read `server/.env`
    or to use a non-local URL. Still, do not run the test suite on the
    production server.
- **Use `127.0.0.1`, not `localhost`**, so name resolution can't send the
  connection anywhere else.
- **Unix sockets** (`host=/var/run/postgresql`) are not supported by the API
  yet. Loopback TCP is the supported setup.

### PostgreSQL access (you apply this; El Niño's lines stay as they are)

Add this line to `pg_hba.conf` for Commissaire's database and role only.
Place it **above** any broader line that would match first, because the first
matching line wins:

```
# Commissaire API on this server (loopback only)
host    commissaire    commissaire_app    127.0.0.1/32    scram-sha-256
```

- Use `host`, not `hostssl`. A `hostssl` line never matches a connection
  without TLS, so the API would be refused with "no pg_hba.conf entry".
  `000-create-database.sql`'s comment suggests `hostssl`; for loopback, use
  `host`.
- Never use `trust` or `peer` for this line.
- Reload without a restart, so El Niño keeps running:
  `SELECT pg_reload_conf();`
- Check that passwords are stored as SCRAM:
  - `SHOW password_encryption;` should return `scram-sha-256`.
  - The role's password must have been set while that was on. As a superuser,
    `SELECT rolpassword LIKE 'SCRAM-SHA-256%' FROM pg_authid WHERE rolname = 'commissaire_app';`
    should return true. If not, run `ALTER ROLE ... PASSWORD` again.
- The role should own only its own database: no SUPERUSER, CREATEDB or
  CREATEROLE. `PUBLIC` must not be able to connect to `commissaire`
  (`verify.sql` check 6).
- **Optional, later.** `listen_addresses` is shared with El Niño, so leave it
  as it is. Once you no longer use DBeaver remotely, you can block remote logins
  to Commissaire's database only, below the loopback line:
  ```
  host    commissaire    all    0.0.0.0/0    reject
  host    commissaire    all    ::/0         reject
  ```
  Until then, keep remote DBeaver access on `hostssl`, limited to your own IP.

## Production `.env`: `/opt/commissaire-api/shared/.env`

It lives only on the server, outside git and outside every release folder.
Owned by `commissaire`, mode `600`; the deploy gate refuses to activate
otherwise. Each release's `server/.env` is a symlink to it, created by the gate
(a release archive containing `server/.env` is refused). The API finds it next
to `server/package.json`, from `dist/server.js` as from `tsx`.

```
NODE_ENV=production
HOST=127.0.0.1                 # only Nginx reaches the API
PORT=4000                      # any free port; check that El Niño and the existing
                               # "commissaire-api" PM2 process don't use it
DATABASE_URL=postgresql://commissaire_app:<url-encoded password>@127.0.0.1:5432/commissaire
                               # no sslmode: loopback
DB_POOL_MAX=10
# Do NOT set DEV_PGLITE. Not needed on loopback: DATABASE_CA_CERT, DATABASE_CA_CERT_FILE,
# DATABASE_TLS_SERVERNAME.

JWT_ACCESS_SECRET=<openssl rand -base64 48>
ACCESS_TOKEN_TTL=15m
REFRESH_TOKEN_DAYS=30

CORS_ORIGINS=https://commissaire.us                 # add https://www.commissaire.us if it serves the app
APP_URL=https://commissaire.us                      # used in invitation links
GOOGLE_CLIENT_IDS=<Commissaire web OAuth client id> # with https://commissaire.us as an authorized origin

MAIL_TRANSPORT=smtp
SMTP_URL=smtps://<user>:<password>@<smtp host>:465
MAIL_FROM=Commissaire <no-reply@commissaire.us>
SMS_ENABLED=false

# Ed25519 key that signs official results. Required in production: without it,
# Finalize returns 503. Generate it once:
#   openssl genpkey -algorithm ed25519
# store it with \n escapes, and keep a backup: changing the key changes future signatures.
RESULTS_SIGNING_KEY=-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----
RESULTS_SIGNING_KEY_ID=prod-2026-10
LOG_LEVEL=info
```

Never leave `CORS_ORIGINS` empty in production: empty means any origin.

## Releases, PM2 and the deploy gate

GitHub Actions builds the API once and ships it as an immutable release; the
server never runs npm or git for a deployment.

```
/opt/commissaire-api/           root:commissaire 1775 (sticky: commissaire cannot rename bin/)
  bin/deploy-gate.sh            root:root 0755  the only command the deploy key can run
  bin/ecosystem.config.cjs      root:root 0644  PM2 app "commissaire-api-live"
  bin/gate.conf                 root:root 0644  optional: NODE_BIN, PM2_BIN, HEALTH_URL
  shared/.env                   commissaire 0600
  releases/<UTC time>-<commit>/ read-only: REVISION, server/{dist,sql,node_modules,package*.json}, server/.env → shared/.env
  current  -> releases/...      switched atomically (rename)
  previous -> releases/...      the release before current (rollback target)
  incoming/                     upload staging
  state/deploy.log, deploy.lock
```

`server/deploy/deploy-gate.sh` (forced command, runs as `commissaire`, no sudo):

| Command | What it does |
|---|---|
| `receive <id> <sha256>` | Archive on stdin, at most 200 MB. Checks the SHA-256, that every path is `REVISION` or `server/...` (relative, no `..`, printable), that it holds only regular files and directories (no links or devices), that `REVISION` matches the id, the required files, and no `server/.env`. Extracts to `releases/<id>`, links `.env`, makes it read-only. An existing release is never overwritten. |
| `activate <id>` | Node ≥ 20 and `shared/.env` (600, owned by `commissaire`) checked; **read-only schema check** (`node dist/db/migrate-cli.js --check`: files recorded, 17 tables, no foreign keys; never migrates) — on failure nothing changes; `current` switched atomically; PM2 restarts only `commissaire-api-live`; health must report `{"ok":true,"release":"<commit>"}` within 30 s. On failure: **automatic rollback** to the previous release (health-checked). On success: `previous` updated, `pm2 save`, keeps the 5 newest releases (never current or previous). |
| `rollback [id]` | Back to `previous` (or the named release), schema-checked and health-checked; restores the release it left if that fails. |
| `status` | Current, previous, releases kept, health. |

PM2 runs under the `commissaire` user's own daemon (`~commissaire/.pm2`), so
El Niño's `pm2 restart all`, `pm2 kill` or `pm2 save` never touch Commissaire,
and the reverse. The gate only ever names `commissaire-api-live`; never use
`pm2 ... all`. Don't reuse, stop or delete the old `commissaire-api` process
until you know what it is. One process only (Socket.IO rooms are in memory).

Before it listens, the API itself also checks the schema read-only and stops,
naming what is missing, if a migration file is not recorded or a table doesn't
exist.

## CI/CD (GitHub Actions)

| Workflow | When | What |
|---|---|---|
| `ci.yml` | Every PR and push (not `main`); called by `deploy.yml` | App: typecheck, lint, tests with coverage, build, build with `VITE_SERVER_URL`, Playwright (local-race regression). Server: typecheck, tests (incl. the real `dist/server.js` and `dist/db/migrate-cli.js`), build, shellcheck, deploy-gate end-to-end test. |
| `deploy.yml` | Push to `main`; or "Run workflow" (choose frontend/backend) | Decides what changed (`server/`, `src/shared/` → backend; anything else but docs → frontend), runs `ci.yml`, then **backend**: build, `pack-release.sh` (archive + SHA-256), approval in environment `production`, `receive` + `activate` over SSH, then checks through Nginx: health reports this commit, Socket.IO handshake, WebSocket upgrade (warning only). **Frontend**: build with `VITE_SERVER_URL`, `verify:dist`, approval in environment `github-pages`, deploy to Pages — after the backend when both deploy. |
| `backend-rollback.yml` | "Run workflow" only | `status`, or `rollback [release]`, approved in `production`. |

Nothing deploys without a manual approval, and database migrations never run
in any workflow: SQL files are applied by hand, before the release that needs
them (the gate's schema check refuses the release until they are).

GitHub configuration (Settings):

| Name | Kind | Value |
|---|---|---|
| `DEPLOY_SSH_KEY` | Secret in environment `production` | Private key of a new ed25519 key pair used only for this |
| `DEPLOY_KNOWN_HOSTS` | Secret in environment `production` | The server's SSH host key line(s), checked against the server's own fingerprint |
| `DEPLOY_HOST` | Variable | `api.commissaire.us` (or `191.215.39.19`) |
| `DEPLOY_USER` | Variable | `commissaire` |
| `DEPLOY_PORT` | Variable (optional) | SSH port if not 22 |
| `VITE_SERVER_URL` | Variable | `https://api.commissaire.us` (unset = the app stays local-only) |
| Environment `production` | Protection | Required reviewer: the owner; deployment branches: `main` only |
| Environment `github-pages` | Protection | Required reviewer: the owner; deployment branches: `main` only |
| Branch `main` | Protection | Require a PR and the CI checks |

### One-time server setup (by hand, as root)

```bash
# User and layout (the old /opt/commissaire/server-OLD is not touched)
id commissaire || adduser --system --group --home /home/commissaire --shell /bin/bash commissaire
# The base is root-owned and sticky: commissaire can create and switch its own
# links (current, previous) but cannot rename or replace the root-owned bin/.
install -d -o root -g commissaire -m 1775 /opt/commissaire-api
install -d -o root -g root -m 0755 /opt/commissaire-api/bin
install -d -o commissaire -g commissaire -m 0755 /opt/commissaire-api/{releases,incoming,state}
install -d -o commissaire -g commissaire -m 0700 /opt/commissaire-api/shared
# Gate and PM2 file from a reviewed checkout of the approved commit
install -o root -g root -m 0755 server/deploy/deploy-gate.sh       /opt/commissaire-api/bin/
install -o root -g root -m 0644 server/deploy/ecosystem.config.cjs /opt/commissaire-api/bin/
# Production settings (edit in place; never echo secrets)
install -o commissaire -g commissaire -m 0600 /dev/null /opt/commissaire-api/shared/.env
# Deploy key: forced command, no shell, no forwarding
install -d -o commissaire -g commissaire -m 0700 /home/commissaire/.ssh
echo 'restrict,command="/opt/commissaire-api/bin/deploy-gate.sh" ssh-ed25519 AAAA... commissaire-deploy' >> /home/commissaire/.ssh/authorized_keys
chown commissaire:commissaire /home/commissaire/.ssh/authorized_keys && chmod 600 /home/commissaire/.ssh/authorized_keys
# PM2 at boot for this user only (separate pm2-commissaire.service)
sudo -iu commissaire pm2 ping
env PATH="$PATH" pm2 startup systemd -u commissaire --hp /home/commissaire
```

A changed `deploy-gate.sh` or `ecosystem.config.cjs` is installed again by
hand, after review; deployments never change `bin/`.

### Rollback

- API: run `backend-rollback.yml` (`rollback`, empty = previous), or on the
  server as `commissaire`: `/opt/commissaire-api/bin/deploy-gate.sh rollback`.
  A failed activation already rolls back by itself.
- App: revert the change on `main` (a PR), or "Run workflow" on `deploy.yml`
  for the frontend after reverting. Unsetting `VITE_SERVER_URL` and deploying
  the frontend makes the app local-only again.
- Database: deployments change no schema or data, so nothing to undo.

## Nginx: `api.commissaire.us`

This is a new file, `/etc/nginx/sites-available/api.commissaire.us`, enabled
with a symlink in `sites-enabled/`. It doesn't touch El Niño's server blocks.

- The names (`commissaire_api`, `$commissaire_connection_upgrade`) are unique,
  so they can't clash with an existing `upstream` or `map` in El Niño's config.
- The API handles CORS and security headers (helmet, including HSTS), so Nginx
  adds none. Duplicate CORS headers break browsers.

```nginx
upstream commissaire_api {
    server 127.0.0.1:4000;
    keepalive 16;
}

# Socket.IO (WebSocket) upgrade, named for Commissaire only
map $http_upgrade $commissaire_connection_upgrade {
    default upgrade;
    ''      close;
}

server {
    listen 80;
    listen [::]:80;
    server_name api.commissaire.us;

    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;                                  # nginx < 1.25.1: "listen 443 ssl http2;" instead
    server_name api.commissaire.us;

    ssl_certificate     /etc/letsencrypt/live/api.commissaire.us/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.commissaire.us/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 12m;                  # the API accepts 10 MB (start list with course maps)

    # Live updates (Socket.IO, namespace /race on the default /socket.io/ path)
    location /socket.io/ {
        proxy_pass http://commissaire_api;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $commissaire_connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;               # above Socket.IO's 25 s ping interval
        proxy_buffering off;
    }

    # REST API
    location / {
        proxy_pass http://commissaire_api;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

The API trusts exactly one proxy (`trust proxy` = 1), so rate limits see the
real client IP. Keep Nginx as the only hop: no second proxy or CDN in front of
it without changing that setting.

Order of steps:

1. DNS: an `A` (and `AAAA`, if IPv6) record for `api.commissaire.us`, pointing
   at the server. `commissaire.us` stays on GitHub Pages.
2. Certificate, without letting certbot edit Nginx files:
   - Enable only the port-80 block first.
   - Then run `sudo certbot certonly --webroot -w /var/www/certbot -d api.commissaire.us`.
3. Enable the full file, then `sudo nginx -t && sudo systemctl reload nginx`.
   Use reload, not restart, so El Niño keeps serving.
4. Check: `curl -s https://api.commissaire.us/api/v1/health`.

## React on GitHub Pages

The app stays on GitHub Pages. It uses the server only when it was built with
`VITE_SERVER_URL=https://api.commissaire.us`; without it, the app stays
local-only, as today. `deploy.yml` passes the repository variable
`VITE_SERVER_URL` to the build, so the app goes live with the API only once
that variable is set (and a frontend deploy is approved).
