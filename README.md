# SOWEN V2 — Full Stack (sans Supabase)

Application de suivi conformité chantier / Bureau de Contrôle.

## Stack
- `front/` — Next.js 16 + TypeScript
- `back/` — NestJS + Prisma
- PostgreSQL 16 via Docker
- Upload local en développement (`back/uploads/`)
- OpenAI optionnel pour l'analyse des rapports PDF
- Resend optionnel pour les emails et relances

## Fonctionnalités actuellement branchées
- création / connexion d'un utilisateur et d'une organisation
- création et modification de projets
- référentiel de lots
- entreprises
- rattachement lot + entreprise à un projet
- observations manuelles
- génération automatique d'un brouillon email lors de la création d'une observation
- bibliothèque de règles et ajout de règles
- pré-contrôle basé sur les règles réelles enregistrées
- import de documents
- import d'un rapport PDF Bureau de Contrôle
- extraction texte PDF
- analyse OpenAI optionnelle et création d'observations depuis le rapport
- mails : envoi individuel, envoi des brouillons, relances
- clôture d'une observation
- journal d'activité backend
- paramètres d'organisation
- état des intégrations

Aucune donnée de démonstration n'est injectée par le seed.

## Installation
Dans le dossier racine :

```powershell
npm install
docker compose up -d
npm run db:generate
npm run db:migrate
```

Quand Prisma demande un nom de migration, utiliser par exemple :

```text
sowen_v2_current
```

Puis lancer deux terminaux :

```powershell
npm run dev:back
```

```powershell
npm run dev:front
```

- Front : http://localhost:3000
- API : http://localhost:4000/api/health

## `.env` backend
Créer `back/.env` depuis `back/.env.example`.

Minimum local :

```env
DATABASE_URL="postgresql://sowen:sowen_dev_password@localhost:5432/sowen?schema=public"
API_PORT=4000
WEB_URL="http://localhost:3000"
JWT_ACCESS_SECRET="CHANGE_ME_LONG_RANDOM_SECRET"
JWT_REFRESH_SECRET="CHANGE_ME_ANOTHER_LONG_RANDOM_SECRET"
JWT_ACCESS_TTL="15m"
JWT_REFRESH_TTL="30d"
```

OpenAI est optionnel au démarrage :

```env
OPENAI_API_KEY=""
OPENAI_MODEL="gpt-5-mini"
```

Sans clé OpenAI, un rapport PDF peut être importé et son texte extrait, mais aucune observation IA n'est créée.

Resend est optionnel au démarrage :

```env
RESEND_API_KEY=""
RESEND_FROM=""
```

Sans ces valeurs, les brouillons existent mais l'envoi réel est bloqué avec un message explicite.

## `.env` frontend
Créer `front/.env.local` :

```env
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

## Premier démarrage
1. Aller sur `/register`.
2. Créer le compte de Youssef / l'organisation.
3. Créer les lots nécessaires dans `Lots`.
4. Créer un projet.
5. Ajouter les entreprises / règles / observations.
6. Configurer OpenAI et Resend seulement lorsqu'ils sont nécessaires.

## Important
Ne jamais committer `back/.env`, `front/.env.local`, les clés OpenAI/Resend ou les mots de passe de production.

## Fonctions V2 ajoutées
SOWEN inclut désormais : mode sombre, interface FR/EN, pré-contrôle enrichi par IA, analyse PDF BC avec confiance IA, preuves avant/après et pièces techniques, score de conformité, scanner d'échéances, relances Resend, portail entreprise par token, historique/audit, règles versionnées, recherche globale, modèles de projet, export CSV/Excel, impression PDF, vue direction et navigation mobile chantier.

Les modèles de projet sont de la **configuration fonctionnelle** et non des données fictives. Les projets, entreprises, observations, règles métier et documents restent issus de PostgreSQL.

## Moteur automatique d'échéances et relances

Le backend peut scanner automatiquement les observations toutes les heures. L'automatisation est désactivée par défaut en local.

Dans `back/.env` :

```env
REMINDER_AUTOMATION_ENABLED="true"
RESEND_API_KEY="..."
RESEND_FROM="SOWEN <no-reply@votre-domaine.fr>"
```

Le scan marque les points en retard / sans retour, applique des niveaux d'escalade selon les paramètres de l'organisation et envoie les relances si Resend est configuré. Le dashboard expose aussi les échéances proches et les brouillons sans destinataire.

## Notification center and contractor portal updates

This checkpoint adds a persistent internal notification center for deadlines, escalations, missing email recipients and pending evidence reviews. Notifications are generated from real PostgreSQL data and are user-specific. Users can mark notifications read, mark all read, and open the related SOWEN screen. ADMIN/EDITOR users can send a digest email through Resend.

Optional environment switch:

```env
DAILY_DIGEST_ENABLED="false"
```

When enabled, the backend schedules a daily digest at 08:00 server time for ADMIN and EDITOR users. Resend still requires `RESEND_API_KEY` and `RESEND_FROM`.

The company portal also supports a text-only response to an observation in addition to file evidence uploads. A contractor response automatically moves an open observation to `WAITING` and is recorded in the activity log.

## Validation finale avant mise en service

Avant toute mise en production, suivre `docs/FINAL_TEST_GUIDE.md` puis exécuter :

```powershell
npm run release:check
```

Un helper Windows est fourni pour générer les secrets JWT et CRON localement sans les récupérer auprès d'un service externe :

```powershell
powershell -ExecutionPolicy Bypass -File tools/generate-secrets.ps1
```
