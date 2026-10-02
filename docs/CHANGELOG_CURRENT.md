# Changelog courant

- suppression des données de démonstration
- login / register avec organisation et nom réel utilisateur
- création projet branchée PostgreSQL
- modification projet
- référentiel lots + ajout de lot
- rattachement lot / entreprise à un projet
- entreprises : liste + création
- observations : liste + création manuelle + clôture
- brouillon email automatique par observation
- règles : liste + création
- pré-contrôle : sauvegarde description + filtrage des règles réelles
- documents : upload réel local + métadonnées PostgreSQL
- rapports BC : upload PDF + extraction texte + analyse Gemini optionnelle
- emails : envoi individuel + envoi brouillons + relance
- journal activité
- paramètres organisation
- état des intégrations
- documentation .env mise à jour

## Enhancement pass - 14 Sep 2026
- Dark mode toggle persisted in browser.
- French / English UI toggle persisted in browser.
- AI-assisted pre-check context (risks, required documents, contractor instructions) when `GEMINI_API_KEY` is configured.
- Bureau de Contrôle PDF analysis enhanced with lot, company, severity, page and AI confidence.
- Observation evidence: before/after photos, photos, PV, certificates, technical sheets and voice notes.
- Compliance score per project and management risk dashboard.
- Deadline scanner and optional automatic Resend reminders for overdue observations.
- Tokenized company portal links by project/company.
- Observation status history + existing project activity log kept as audit trail.
- Versioned rule endpoint and rule-library UI action for new versions.
- Global search across rules, observations and projects.
- Project templates (Hotel ERP O, ERP, IGH, Office, Retail) that create/attach suggested lots.
- CSV export (Excel-compatible) and browser Print/PDF action.
- Mobile bottom navigation and larger mobile actions.
- Global management page for risky projects, overdue observations and companies with open items.

## Security + authentication hardening checkpoint
- Organization scoping added to reports, documents, evidence, emails, activity, analytics, search, pre-checks, reminders and project-lot mutations.
- Audit logs now store the authenticated user for the main write actions.
- Email resolve link also resolves its linked observation and records history.
- Company portal access validates company/project ownership and requires the company to be assigned to the project.
- Company portal links can be revoked and can upload evidence only to observations assigned to that company/project.
- Login/register UI now supports dark mode and language controls and preserves the requested post-login route.
- Added admin team management: list users, add user, change roles and remove users while preventing self-role/self-delete lockouts.
- Rules creation/version/archive restricted to ADMIN and every new rule creates version 1 automatically.

## AI report analysis & pre-control hardening
- Added centralized `AiService` and `GEMINI_MODEL` configuration.
- Bureau de Contrôle PDF analysis now stores AI model, average confidence, analysis status, raw AI result, observation count and errors.
- Added `PENDING / PROCESSING / COMPLETED / NEEDS_REVIEW / FAILED` report analysis states.
- Added low-confidence review flag and report re-analysis endpoint.
- AI-extracted observations validate confidence, severity and page values before persistence.
- Pre-control now stores AI model/confidence with each work description and keeps the rules database as the source of truth.
- Frontend now displays AI confidence/model and explicit review warnings instead of silently trusting uncertain results.

## 2026-09-14 — AI → actions entreprise
- Les observations issues des rapports BC avec confiance >= 75% peuvent maintenant recevoir automatiquement une échéance et un brouillon d'email.
- SOWEN tente d'affecter l'entreprise à partir du lot du projet et réutilise l'email entreprise/contact lot.
- Les observations IA sous 75% restent en OPEN sans envoi automatique et sont comptabilisées comme « à valider ».
- Le pré-contrôle permet désormais de sélectionner les règles confirmées et de les convertir en observations/actions entreprise + brouillons.
- Les actions générées utilisent les données PostgreSQL réelles et évitent les données de démonstration.

## Consistency pass
- Added missing project-scoped routes for pre-control, reports, observations, documents and emails.
- Project-scoped managers now filter/create records against the selected project.
- Expanded FR/EN coverage across authentication and core workflow labels.
- Kept empty states backed by real API data only; no demo records added.

## Passe robustesse / cohérence UI
- Ajout des états globaux `loading`, `error` et `not-found` Next.js.
- Message explicite lorsque le backend est inaccessible.
- États UI réutilisables pour chargement, erreur et absence de données.
- Navigation active dans la sidebar et la barre mobile.
- Améliorations responsive formulaires, modales, tableaux et actions sticky sur mobile.
- Focus clavier plus visible pour l'accessibilité.
- Scripts `npm run check` / `typecheck` ajoutés.
- Checklist de pré-livraison et smoke test local documentés.

## Release hardening
- Environment validation at API startup.
- Real PostgreSQL health check.
- Integration status no longer assumes the database is healthy.
- Automation and daily-digest status exposed in settings API.

## 2026-10-02 — Migration de l'analyse IA de Gemini vers Claude
- Le fournisseur IA actif est désormais Claude (API Anthropic, SDK officiel `@anthropic-ai/sdk`) ; la dépendance `@google/genai` est supprimée.
- Configuration backend : `ANTHROPIC_API_KEY` et `ANTHROPIC_MODEL` (par défaut `claude-opus-5-5`) remplacent `GEMINI_API_KEY` et `GEMINI_MODEL`. Les mentions de Gemini dans les entrées précédentes de ce journal sont conservées telles quelles.
- Tout PDF lisible est analysé : type de document, résumé, pertinence, informations clés et confiance, en plus des observations.
- Réponse en JSON strict (schéma imposé à Claude) validée par le backend avant enregistrement ; une réponse invalide passe le rapport en `FAILED`.
- Observations catégorisées (observation, non-conformité, réserve, remarque technique, recommandation) ; numéros de page issus de marqueurs de page ajoutés au texte extrait.
- Les lots du projet et les entreprises de l'organisation sont transmis à l'IA pour fiabiliser le rattachement.
- Un PDF sans texte exploitable (scanné ou vide) passe en `FAILED` avec un message explicite, sans appel à l'IA.
- `GET /api/system/status` expose `ai` et `aiProvider` à la place de `gemini`.
- Page rapport : libellés IA génériques, fournisseur, modèle, analyse du document et catégorie de chaque observation.
