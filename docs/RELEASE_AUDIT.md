# SOWEN V2 — Release candidate audit

## Completed in this pass

- verified the main Next.js page routes referenced by the current navigation exist;
- confirmed the Prisma seed creates no demonstration/business data;
- corrected the upload ignore path so local files under `back/uploads/` are not committed;
- added server-side upload limits (20 MB);
- restricted Bureau de Contrôle report upload to PDF;
- restricted evidence/document uploads to supported PDF/image/audio MIME types;
- added `npm run preflight` to catch missing release files, accidental local `.env` files, missing ignore rules, and obvious committed provider keys;
- added `npm run release:check` as the final typecheck + build gate.

## Final checks that must run on the development PC

A complete TypeScript/build verification requires installed npm dependencies and a generated Prisma client. Run:

```powershell
npm install
npm run db:generate
npm run release:check
```

Then start PostgreSQL and perform the smoke test documented in `docs/SMOKE_TEST.md`.

## Production notes

- Keep `REMINDER_AUTOMATION_ENABLED=false` and `DAILY_DIGEST_ENABLED=false` until Resend and the production scheduler are configured.
- Do not enable real AI actions until `GEMINI_API_KEY` is configured and low-confidence observations are reviewed by a human.
- Local JWT storage is acceptable for this development build, but for a hardened internet-facing deployment consider moving refresh-token handling to Secure/HttpOnly cookies.
- The regulatory knowledge base must remain sourced/versioned and should not treat model output as the legal source of truth.
