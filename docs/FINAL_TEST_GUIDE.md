# SOWEN V2 — Test final local

Ce test doit être exécuté sur le PC Windows de livraison avant de considérer la release comme validée.

## 1. Préparer les fichiers d'environnement

Depuis la racine du projet :

```powershell
Copy-Item back/.env.example back/.env
Copy-Item front/.env.example front/.env.local
```

Générer trois secrets différents :

```powershell
powershell -ExecutionPolicy Bypass -File tools/generate-secrets.ps1
```

Copier les trois valeurs dans `back/.env`.

Claude, Resend et S3/R2 peuvent rester vides pour le premier démarrage.

## 2. Installer et lancer PostgreSQL

```powershell
npm install
docker compose up -d
```

Vérifier :

```powershell
docker compose ps
```

Le conteneur `sowen-postgres` doit être `Up`.

## 3. Préparer la base

En développement local uniquement. En production : `npm run db:deploy` (`prisma migrate deploy`), voir `docs/DEPLOYMENT.md`.

```powershell
npm run db:generate
npm run db:migrate
```

## 4. Vérifier la release

```powershell
npm run preflight
npm run check
npm run build
```

Ou en une seule commande :

```powershell
npm run release:check
```

## 5. Lancer l'application

Terminal 1 :

```powershell
npm run dev:back
```

Terminal 2 :

```powershell
npm run dev:front
```

Tester :

- API : `http://localhost:4000/api/health`
- Front : `http://localhost:3000`
- Premier compte (développement local ; en production voir `docs/DEPLOYMENT.md`) : `http://localhost:3000/register` (fermé ensuite ; `ALLOW_PUBLIC_REGISTRATION="true"` dans `back/.env` pour le rouvrir)

## 6. Smoke test métier

1. Créer le premier compte et l'organisation.
2. Se connecter puis se déconnecter/reconnecter.
3. Créer une entreprise et un lot.
4. Créer un projet et rattacher lot + entreprise.
5. Créer une observation manuelle.
6. Ajouter un document / une preuve.
7. Créer une règle.
8. Tester le pré-contrôle sans clé Anthropic : le système doit rester utilisable et signaler que l'IA est inactive.
9. Importer un PDF Bureau de Contrôle sans clé Anthropic : l'import doit fonctionner, l'analyse IA doit être explicitement indisponible.
10. Vérifier FR / EN, clair / sombre et l'affichage mobile.
11. Vérifier le centre de notifications et le journal d'activité.
12. Vérifier l'export CSV/Excel et l'impression PDF.

## 7. Activer Claude plus tard

Dans `back/.env` :

```env
ANTHROPIC_API_KEY="..."
ANTHROPIC_MODEL="claude-opus-5-5"
```

Redémarrer le backend après modification.

## 8. Activer les emails plus tard

Dans `back/.env` :

```env
RESEND_API_KEY="..."
RESEND_FROM="SOWEN <no-reply@votre-domaine.fr>"
```

Laisser les automatisations désactivées jusqu'à validation manuelle des emails :

```env
REMINDER_AUTOMATION_ENABLED="false"
DAILY_DIGEST_ENABLED="false"
```

## Critère de validation

La release est validée lorsque `npm run release:check` termine sans erreur et que le smoke test principal fonctionne avec une base PostgreSQL vierge.
