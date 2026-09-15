# SOWEN V2 — État de release

## Inclus dans le package

- Frontend Next.js / TypeScript
- Backend NestJS / Prisma
- PostgreSQL via Docker Compose
- Auth JWT et rôles
- Isolation par organisation
- Projets, lots, entreprises, observations, règles, documents et rapports
- Pré-contrôle et intégration OpenAI optionnelle
- Analyse PDF BC avec score de confiance
- Preuves / réponses entreprise
- Workflow de validation, relance, clôture et réouverture
- Notifications, échéances et escalades
- Portail entreprise par lien sécurisé
- Historique / audit
- FR / EN
- Mode clair / sombre
- Vue mobile
- Exports
- Scripts de préflight et vérification de release

## Non activé par défaut

- Envoi réel Resend
- Analyse OpenAI
- Stockage S3/R2
- Relances automatiques
- Digest quotidien

Ces fonctions nécessitent leurs clés/paramètres dans `back/.env`.

## Dernier gate requis

Le build complet dépend de l'installation des dépendances npm et doit être confirmé sur la machine de livraison avec :

```powershell
npm install
npm run db:generate
npm run release:check
```
