# Deploying SOWEN in production

This describes a single server (for example an OVH VPS) running Docker, with Nginx in front for HTTPS.
The files are in `deploy/`.

```
internet ──443──> Nginx (HTTPS, host) ──127.0.0.1:3000──> web  (Next.js, container)
                                      ──127.0.0.1:4000──> api  (NestJS, container) ──> postgres (container, no port)
```

## 1. What is exposed

| Port | Service | Reachable from |
|---|---|---|
| 443 | Nginx, HTTPS | internet |
| 80 | Nginx, redirect to HTTPS and certificate renewal only | internet |
| 22 | SSH, keys only, no root login | your addresses if possible |
| 3000 | web application | `127.0.0.1` only |
| 4000 | API | `127.0.0.1` only |
| 5432 | PostgreSQL | nothing outside the Docker network: no `ports:` entry |

Docker publishes ports past `ufw`. The `127.0.0.1:` prefix in `deploy/docker-compose.prod.yml` is what keeps ports
3000 and 4000 private: never remove it. From another machine, check that only 22, 80 and 443 answer:

```
nmap -Pn -p 22,80,443,3000,4000,5432 <server address>
```

PostgreSQL is never reachable from the internet. For an occasional manual access, use
`docker compose exec postgres psql` on the server, or an SSH tunnel.

## 2. Settings

Two files, neither of them in Git. Create them from the examples and restrict them:

```
cd deploy
cp .env.example .env
cp api/.env.example api/.env
chmod 600 .env api/.env
```

- `deploy/.env`: the public https address and the database password (`openssl rand -hex 32`).
- `deploy/api/.env`: the secrets and settings of the API.

Generate four different values with `openssl rand -base64 48` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and
`PORTAL_TOKEN_SECRET` (and `CRON_SECRET`, only if you use it). On a real installation (`NODE_ENV="production"`, or
`PUBLIC_APP_URL` set) the API refuses to start when:

- a secret is an example value (`CHANGE_ME…`), shorter than 32 characters, or not random;
- two secrets are identical;
- `DATABASE_URL` uses the development database password of the repository (in production);
- `PUBLIC_APP_URL` is not `https://` (in production);
- `TRUST_PROXY` is not a number.

Keep a copy of `PORTAL_TOKEN_SECRET` outside the server: if it changes, every portal link already sent stops working.

`CRON_SECRET` stays empty. The reminder scan runs inside the API every hour; the external endpoint
`POST /api/reminders/cron` is disabled while `CRON_SECRET` is empty.

Use API keys created for production (Anthropic, email), not the ones used in development.

## 3. Reverse proxy and `TRUST_PROXY`

The API limits sign-in attempts per visitor address. Behind Nginx it reads that address from `X-Forwarded-For`,
and only when told how many proxies are in front of it.

| Situation | `TRUST_PROXY` |
|---|---|
| One Nginx in front of the API (this setup) | `"1"` (set by `docker-compose.prod.yml`) |
| Nginx behind another proxy or load balancer | `"2"` |
| API reached directly, no proxy (development) | empty |

Two rules go together:

1. With a proxy and `TRUST_PROXY` empty, every visitor has the address of the proxy: one person's failed attempts
   lock everyone out.
2. With `TRUST_PROXY` set, the API must not be reachable except through the proxy, otherwise a visitor could write
   the header themselves. This is why the API port is published on `127.0.0.1` only. Outside Docker, the API
   listens on `127.0.0.1` by itself as soon as `TRUST_PROXY` is set (`API_HOST` overrides it).

`deploy/nginx/sowen.conf.example` replaces `X-Forwarded-For` with the real address of the visitor instead of
appending to it, masks portal and invitation tokens in the access log, limits request rates on sign-in and portal
routes, and accepts bodies up to 25 MB. Install it, then:

```
nginx -t && systemctl reload nginx
curl -sI https://app.example.com | grep -iE "strict-transport|content-security|x-frame|x-content-type|referrer"
```

HTTPS is required: obtain the certificate (for example with certbot) before opening the service. The application
sends `Strict-Transport-Security` only in production over https.

The Nginx error log cannot be masked the same way: a request refused by a rate limit is written there with its
address. Keep `/var/log/nginx` readable by root only and its retention short.

## 4. Database migrations

Production uses **`prisma migrate deploy`** only. It applies the migrations of the repository and never resets or
alters anything else.

```
cd deploy
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d postgres
docker compose -f docker-compose.prod.yml --env-file .env run --rm api node ../node_modules/prisma/build/index.js migrate deploy
```

Never run `prisma migrate dev` (or `npm run db:migrate`, which calls it) against a production database: it is a
development command that can ask to reset the database. Without Docker the equivalent is `npm run db:deploy`.

Take a backup before every migration (see `docs/BACKUP_RESTORE.md`). An installation that already holds rules
created before the per-organisation library needs the extra step of `docs/RULES_LIBRARY.md`.

## 5. First administrator

On a real installation the public registration page is closed, including while the database is empty: nobody on
the internet can create the first account. Create it on the server:

```
docker compose -f docker-compose.prod.yml --env-file .env run --rm api \
  node ../node_modules/tsx/dist/cli.mjs scripts/create-admin.ts \
  --email you@example.com --name "Your Name" --organization "Your company"
```

The command stores no password. It prints a single-use link, valid 72 hours, with which you choose your password
in the browser. Treat the link like a password. The following users are invited from the Team page.

`ALLOW_PUBLIC_REGISTRATION` stays `"false"`.

## 6. Start and check

```
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml --env-file .env ps
curl -s http://127.0.0.1:4000/api/health
```

Then, from outside:

- [ ] only 22, 80 and 443 answer (`nmap`)
- [ ] `http://` redirects to `https://`
- [ ] the security headers are present (`curl -sI`)
- [ ] `https://app.example.com/api/auth/registration` answers `{"open":false}`
- [ ] a failed sign-in is counted for your own address: after 5 wrong passwords you are refused, a colleague on
      another connection is not
- [ ] `/var/log/nginx/sowen.access.log` shows `/portal/[redacted]`, never a token
- [ ] the first backup has been sent off the server and a restore has been tried

## 7. Updating

```
git pull
cd deploy
./backup.sh
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env run --rm api node ../node_modules/prisma/build/index.js migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

Sessions opened before the version that introduced server-side sessions are not recognised: users sign in again
once after that update.
