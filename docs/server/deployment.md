# Production deployment: API next to PostgreSQL

Target layout (not deployed yet):

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

## Production `server/.env`

Keep it outside git, owned by the service user, and readable only by them
(`chmod 600`). The API finds it next to `server/package.json`, both under
`npm start` (`dist/server.js`) and under `tsx`.

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

## Running the API

Build and start it as its own system user, separate from El Niño's:

```
cd /opt/commissaire/server && npm ci && npm run build
npm run migrate        # read-only on this database: lists missing files, exit 1 if any
npm start              # node dist/server.js
```

Before it listens, the API checks the schema read-only. It stops, naming what
is missing, if a migration file is not recorded or a required table doesn't
exist.

### PM2, without affecting El Niño

Run Commissaire under its **own Linux user** (`commissaire`), so it has its own
PM2 daemon (`~commissaire/.pm2`). Then `pm2 restart all`, `pm2 kill` or
`pm2 save` run as El Niño's user never touch Commissaire, and the reverse.

- Use a new process name, `commissaire-api-live`.
- Don't reuse, stop or delete the existing `commissaire-api` process until you
  know what it is.
- Always name the process in commands (`pm2 restart commissaire-api-live`);
  never use `all`.

As the `commissaire` user:

```
cd /opt/commissaire/server
pm2 start dist/server.js --name commissaire-api-live --time --max-memory-restart 512M
pm2 save
```

Start on boot, for this user only: run `pm2 startup systemd -u commissaire --hp /home/commissaire`,
then run the `sudo` command it prints. That creates a separate
`pm2-commissaire.service` and leaves El Niño's PM2 service alone.

Check it: `curl -s http://127.0.0.1:4000/api/v1/health` should return `{"ok":true,...}`.

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
local-only, as today. Two changes, both needing your approval because they
affect production:

- Add a repository variable `VITE_SERVER_URL`.
- Pass it in the build step of `.github/workflows/deploy.yml`, as the
  `VITE_FIREBASE_*` variables already are.

A push to `main` deploys.
