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
- En production (`NODE_ENV="production"` ou `PUBLIC_APP_URL` renseignée), `/register` est fermée même si aucun compte n'existe : le premier administrateur est créé sur le serveur avec `npm --workspace back run admin:create` (voir `docs/DEPLOYMENT.md`).
- `ALLOW_PUBLIC_REGISTRATION` : la page `/register` ne sert qu'à créer le tout premier compte (administrateur). Dès qu'un compte existe, elle redirige vers la connexion et l'API refuse l'inscription ; les autres utilisateurs sont ajoutés par un administrateur dans Paramètres. Mettre `true` uniquement pour rouvrir l'inscription publique.
- `ANTHROPIC_API_KEY` : nécessaire uniquement pour analyser automatiquement le contenu des PDF importés (Claude).
- `ANTHROPIC_MODEL` : modèle Claude utilisé par l'analyse IA, par défaut `claude-opus-5-5`.
- `EMAIL_PROVIDER` : `gmail` ou `resend` (Resend si la variable est vide). Nécessaire uniquement pour envoyer les emails et relances.
- `GMAIL_USER` + `GMAIL_APP_PASSWORD` : compte Gmail expéditeur et mot de passe d'application, lorsque `EMAIL_PROVIDER="gmail"`.
- `RESEND_API_KEY` + `RESEND_FROM` : lorsque le fournisseur est Resend.
- `SENT_REMINDER_AFTER_DAYS` : nombre de jours sans réponse de l'entreprise après lesquels une observation « Envoyé » est relancée par le scan (3 par défaut, `0` pour désactiver).
- `REMINDER_AUTOMATION_ENABLED` : `true` pour que le scan des relances tourne automatiquement chaque heure (planificateur interne et point d'entrée `POST /reminders/cron`).
- `MAX_AUTOMATIC_REMINDERS` : nombre maximal de relances envoyées par le scan pour un même mail (3 par défaut, `0` pour ne jamais envoyer).
- `REMINDER_TIMEZONE`, `REMINDER_START_HOUR`, `REMINDER_END_HOUR` : plage d'envoi des relances automatiques, du lundi au vendredi (`Europe/Paris`, de 8 h à 18 h par défaut). Le scan lancé manuellement par un administrateur n'est pas limité par cette plage.
- `PUBLIC_APP_URL` : adresse publique de l'application web. Lorsqu'elle est renseignée, les emails envoyés aux entreprises contiennent un bouton « Répondre dans SOWEN » vers leur portail (l'accès portail est créé à l'envoi s'il n'existe pas) et les invitations d'utilisateurs partent par email. Sans elle, aucun lien n'est ajouté aux emails : le lien est affiché à l'équipe, qui le transmet elle-même. Dès qu'elle est renseignée, `PORTAL_TOKEN_SECRET` devient obligatoire.
- `PORTAL_TOKEN_SECRET` : secret qui signe les liens du portail entreprise. Voir « Portail entreprise » ci-dessous.
- `PORTAL_ACCESS_TTL_DAYS` : durée de validité d'un accès portail, en jours (90 par défaut, `0` pour ne jamais expirer).
- `DAILY_DIGEST_ENABLED` : `true` pour envoyer la synthèse quotidienne aux administrateurs et éditeurs ayant des notifications non lues.
- `DAILY_DIGEST_TIMEZONE` : fuseau horaire de la synthèse (nom IANA, `Europe/Paris` par défaut). L'envoi a lieu à 08:00 dans ce fuseau, du lundi au vendredi, une seule fois par utilisateur et par jour.
- `STORAGE_PROVIDER` : `local` (par défaut) ou `s3`. Voir « Preuves / documents » ci-dessous.
- `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` : utilisés uniquement lorsque `STORAGE_PROVIDER="s3"`.

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

### Portail entreprise
Chaque entreprise reçoit un lien personnel vers son portail (réponse, dépôt de justificatifs). Ce lien n'est pas stocké en base : il est composé de l'identifiant de l'accès et d'une signature calculée avec `PORTAL_TOKEN_SECRET`.

- `PORTAL_TOKEN_SECRET` est un secret à part, **indépendant des secrets JWT** : changer `JWT_ACCESS_SECRET` ou `JWT_REFRESH_SECRET` ne modifie pas les liens portail.
- Valeur : chaîne aléatoire d'au moins 24 caractères, différente des deux secrets JWT (par exemple `openssl rand -base64 48`). Elle n'est jamais affichée dans l'interface, les journaux ni l'historique.
- **Production** : obligatoire lorsque `NODE_ENV="production"` ou dès que `PUBLIC_APP_URL` est renseignée. Sans lui, l'API refuse de démarrer avec un message explicite.
- **Développement local** (ni `NODE_ENV="production"` ni `PUBLIC_APP_URL`) : s'il est vide, une clé de développement dérivée de `JWT_ACCESS_SECRET` est utilisée et un avertissement est écrit au démarrage. Ce repli n'existe pas en production.
- **Rotation** : changer `PORTAL_TOKEN_SECRET` invalide immédiatement tous les liens portail déjà envoyés. Les accès restent en base ; il suffit de régénérer l'accès (ou de renvoyer l'observation) pour transmettre un nouveau lien. Renseigner le secret pour la première fois sur une installation qui utilisait la clé de développement a le même effet.

### Preuves / documents
Tous les fichiers (documents, justificatifs, dépôts du portail entreprise, rapports) passent par un service de stockage unique. La base de données ne contient qu'une clé relative (`<projet>/reports/<fichier>`), jamais un chemin absolu ni une URL.

- `STORAGE_PROVIDER="local"` : fichiers dans `back/uploads/` (ou `STORAGE_LOCAL_DIR`). Prévu pour le développement.
- `STORAGE_PROVIDER="s3"` : stockage objet compatible S3. Le bucket reste privé : les fichiers sont servis uniquement par l'API SOWEN après vérification de l'organisation ; aucune URL publique ou signée n'est produite.

```env
STORAGE_PROVIDER="s3"
S3_ENDPOINT="https://..."        # vide pour AWS S3
S3_REGION="..."                  # ex. gra (OVH), auto (Cloudflare R2)
S3_BUCKET="..."
S3_ACCESS_KEY_ID="..."
S3_SECRET_ACCESS_KEY="..."
```
`S3_FORCE_PATH_STYLE` (optionnel) : `true` par défaut dès qu'un `S3_ENDPOINT` est renseigné.

Si `s3` est sélectionné mais incomplet ou injoignable, l'application ne bascule pas sur le disque local : les envois échouent avec un message clair et Paramètres affiche l'erreur.

Migration des fichiers existants (à lancer une fois, après avoir configuré le bucket) :
```bash
npm --workspace back run storage:migrate -- --dry-run   # aperçu, ne modifie rien
npm --workspace back run storage:migrate                # envoi puis mise à jour de la base
```
Le script peut être relancé sans risque, ne supprime aucun fichier local et signale les fichiers manquants ou sans fiche.
