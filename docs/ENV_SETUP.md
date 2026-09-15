# Configuration des variables d'environnement

## Backend `back/.env`

### Requis en local
- `DATABASE_URL` : connexion PostgreSQL utilisée par Prisma.
- `API_PORT` : port NestJS, par défaut `4000`.
- `WEB_URL` : origine autorisée CORS, par défaut `http://localhost:3000`.
- `JWT_ACCESS_SECRET` : secret généré localement.
- `JWT_REFRESH_SECRET` : deuxième secret distinct.

### Optionnel
- `OPENAI_API_KEY` : nécessaire uniquement pour analyser automatiquement le contenu des rapports BC.
- `OPENAI_MODEL` : modèle utilisé par le module rapports.
- `RESEND_API_KEY` + `RESEND_FROM` : nécessaires uniquement pour envoyer les emails et relances.
- variables `S3_*` : réservées au stockage objet de production.

Les secrets JWT ne sont pas récupérés auprès d'un fournisseur : ils doivent être générés par l'administrateur.

## Frontend `front/.env.local`

```env
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

Aucune clé privée ne doit être mise dans le frontend.

## Fonctionnalités avancées
### Analyse IA / pré-contrôle IA
Créer une clé API OpenAI et renseigner uniquement le backend :
```env
OPENAI_API_KEY="..."
OPENAI_MODEL="gpt-5-mini"
```
Sans clé, le pré-contrôle réglementaire reste utilisable avec le moteur de règles PostgreSQL, mais l'extraction IA des risques/documents n'est pas exécutée.

### Emails et relances automatiques
```env
RESEND_API_KEY="..."
RESEND_FROM="SOWEN <suivi@votre-domaine.fr>"
```
Sans ces variables, les brouillons restent dans SOWEN et le scanner d'échéances marque les points à relancer sans envoyer de mail.

### Preuves / documents
En développement, les fichiers sont stockés localement dans `back/uploads/`. Les variables `S3_*` restent réservées au passage en stockage objet en production.
