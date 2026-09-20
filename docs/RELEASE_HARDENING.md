# Release hardening checkpoint

This checkpoint adds startup validation and real service health checks before the final SOWEN V2 delivery.

## Backend startup requirements

The API now refuses to start if any of these values are missing:

- `DATABASE_URL`
- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`

JWT secrets must be different and at least 24 characters long.

## Health endpoint

`GET /api/health` is public and now performs a real PostgreSQL query. A healthy response contains:

```json
{
  "ok": true,
  "service": "sowen-api",
  "database": "connected"
}
```

If PostgreSQL cannot be reached, the endpoint returns HTTP 503.

## Settings integration status

`GET /api/system/status` now verifies PostgreSQL instead of returning a hard-coded `true`, and also reports whether Gemini, Resend, S3/R2, reminder automation, and daily digest are configured.

## Upload hardening

All report/document/evidence uploads now have a 20 MB server-side limit. Bureau de Contrôle report upload accepts PDF only. General project/evidence upload accepts PDF, common image formats, and common audio formats. Local development uploads are ignored from Git through `back/uploads/`.

## Local release preflight

Run this before handing over a build:

```powershell
npm run preflight
```

For the full local release check, after dependencies and Prisma client are installed:

```powershell
npm run release:check
```
