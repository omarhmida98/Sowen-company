# Initial API routes

Base URL: `http://localhost:4000/api`

## Health
- `GET /health`

## Auth
- `POST /auth/register`
- `POST /auth/login`

## Projects
- `GET /projects?organizationId=...`
- `GET /projects/:id`
- `POST /projects`
- `PATCH /projects/:id`
- `DELETE /projects/:id`

## Rules
- `GET /rules?domain=&buildingType=&erpType=&lotId=`
- `GET /rules/:id`

## Observations
- `GET /observations?projectId=...`
- `GET /observations/:id`
- `POST /observations`
- `PATCH /observations/:id`

## Reports
- `POST /reports/analyze-text`

The initial AI endpoint accepts extracted text. The next pass adds multipart PDF upload, text extraction and OCR fallback.

## Emails
- `GET /emails?projectId=...`
- `POST /emails/:id/send`
- `POST /emails/resolve/:token`

## Documents
- `GET /documents?projectId=...`

## V2 enhancement routes
- `GET /analytics/projects/:id/score` — project compliance score and score by lot.
- `GET /analytics/management` — management KPIs, at-risk projects and company open-point counts.
- `GET /search?q=...` — search rules, observations and projects.
- `GET /evidence?observationId=...` — list proof/evidence for an observation.
- `POST /evidence/upload?observationId=...&type=BEFORE|AFTER|PHOTO|PV|CERTIFICATE|TECHNICAL_SHEET|VOICE_NOTE|OTHER` — upload evidence.
- `POST /portal/access` — create a tokenized portal link for one company/project.
- `GET /portal/:token` — return company-scoped observations for a valid portal token.
- `POST /reminders/scan` — mark overdue observations for relaunch and send reminders when Resend is configured.
- `GET /templates` — built-in project templates (configuration, not demo data).
- `POST /rules/:id/versions` — add a new version while keeping history.
- `GET /exports/projects/:id/csv` — Excel-compatible observation export.

## Authenticated security additions
- GET /api/organizations/me
- PATCH /api/organizations/me (ADMIN)
- GET /api/users (ADMIN)
- POST /api/users (ADMIN)
- PATCH /api/users/:id/role (ADMIN)
- DELETE /api/users/:id (ADMIN)
- POST /api/portal/access (ADMIN/EDITOR)
- DELETE /api/portal/access/:id (ADMIN/EDITOR)
- GET /api/portal/:token (public token)
- POST /api/portal/:token/evidence (public token, limited to assigned observations)

### POST /api/compliance/materialize
Transforme les règles sélectionnées d'un pré-contrôle en observations/actions entreprise et génère les brouillons associés.
Body: `{ "workDescriptionId": "uuid", "ruleIds": ["uuid"] }`
