# Configuration des variables d'environnement

## Backend `back/.env`

### Requis en local
- `DATABASE_URL` : connexion PostgreSQL utilisée par Prisma.
- `API_PORT` : port NestJS, par défaut `4000`.
- `WEB_URL` : liste des origines autorisées CORS, séparées par des virgules. Par défaut `http://localhost:3000`. Exemple avec un tunnel ngrok :
  ```env
  WEB_URL="http://localhost:3000,https://mon-tunnel.ngrok-free.app"
  ```
- `JWT_ACCESS_SECRET` : secret généré localement.
- `JWT_REFRESH_SECRET` : deuxième secret distinct.

### Optionnel
- `ANTHROPIC_API_KEY` : nécessaire uniquement pour analyser automatiquement le contenu des PDF importés (Claude).
- `ANTHROPIC_MODEL` : modèle Claude utilisé par l'analyse IA, par défaut `claude-opus-5-5`.
- `EMAIL_PROVIDER` : `gmail` ou `resend` (Resend si la variable est vide). Nécessaire uniquement pour envoyer les emails et relances.
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` : compte Gmail expéditeur et mot de passe d'application, lorsque `EMAIL_PROVIDER="gmail"`.
- `RESEND_API_KEY` + `RESEND_FROM` : lorsque le fournisseur est Resend.
- `SENT_REMINDER_AFTER_DAYS` : nombre de jours sans réponse de l'entreprise après lesquels une observation « Envoyé » est relancée par le scan (3 par défaut, `0` pour désactiver).
- `PUBLIC_APP_URL` : adresse publique de l'application web. Si elle est renseignée et que l'entreprise dispose déjà d'un accès portail actif pour le projet, les emails contiennent un bouton « Répondre / transmettre les justificatifs » ; sinon aucun lien n'est ajouté.
- variables `S3_*` : réservées au stockage objet de production.

Les secrets JWT ne sont pas récupérés auprès d'un fournisseur : ils doivent être générés par l'administrateur.

## Frontend `front/.env.local`

```env
NEXT_PUBLIC_API_URL="http://localhost:4000/api"
```

Aucune clé privée ne doit être mise dans le frontend.

## Fonctionnalités avancées
### Analyse IA / pré-contrôle IA
Créer une clé API Anthropic (console Claude) et renseigner uniquement le backend :
```env
ANTHROPIC_API_KEY="..."
ANTHROPIC_MODEL="claude-opus-5-5"
```
La clé n'est jamais transmise au frontend ni écrite dans les logs.
Sans clé, le pré-contrôle réglementaire reste utilisable avec le moteur de règles PostgreSQL, mais l'extraction IA des risques/documents n'est pas exécutée.

### Emails et relances automatiques
```env
EMAIL_PROVIDER="gmail"
GMAIL_USER="adresse@gmail.com"
GMAIL_APP_PASSWORD="mot de passe d'application à 16 caractères"
```
L'envoi passe par SMTP Gmail en TLS (smtp.gmail.com:465). Le mot de passe d'application se crée dans le compte Google (validation en deux étapes requise) ; ce n'est pas le mot de passe du compte. L'expéditeur affiché est toujours l'adresse `GMAIL_USER`.

Avec Resend à la place :
```env
EMAIL_PROVIDER="resend"
RESEND_API_KEY="..."
RESEND_FROM="SOWEN <suivi@votre-domaine.fr>"
```
Sans ces variables, les brouillons restent dans SOWEN et le scanner d'échéances marque les points à relancer sans envoyer de mail.

### Preuves / documents
En développement, les fichiers sont stockés localement dans `back/uploads/`. Les variables `S3_*` restent réservées au passage en stockage objet en production.
