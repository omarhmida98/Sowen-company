# SOWEN V2 — Checklist avant livraison

## Installation propre
- [ ] `npm install`
- [ ] `docker compose up -d`
- [ ] créer `back/.env` depuis `back/.env.example`
- [ ] créer `front/.env.local` depuis `front/.env.example`
- [ ] `npm run db:generate`
- [ ] développement local : `npm run db:migrate`
- [ ] production : `npm run db:deploy` (`prisma migrate deploy`), jamais `db:migrate` — voir `docs/DEPLOYMENT.md`
- [ ] `npm run check`
- [ ] `npm run build`

## Authentification
- [ ] créer le premier compte ADMIN
- [ ] login / logout
- [ ] refresh token après expiration
- [ ] accès refusé sans session
- [ ] rôles ADMIN / EDITOR / USER vérifiés
- [ ] données d'une autre organisation inaccessibles

## Parcours principal
- [ ] créer un projet
- [ ] associer lots et entreprises
- [ ] créer une observation manuelle
- [ ] importer un rapport PDF
- [ ] pré-contrôle IA avec et sans clé Anthropic
- [ ] vérifier seuil de confiance IA / « À valider »
- [ ] générer un brouillon
- [ ] envoyer via Resend (si configuré)
- [ ] relancer une observation
- [ ] déposer et valider/refuser une preuve
- [ ] clôturer puis rouvrir une observation

## UX
- [ ] FR / EN sur les parcours principaux
- [ ] mode clair / sombre
- [ ] mobile 390 px
- [ ] tablette 768 px
- [ ] états vides sans données fictives
- [ ] erreurs API compréhensibles
- [ ] boutons désactivés pendant les requêtes
- [ ] navigation clavier et focus visibles

## Automatisation
- [ ] `REMINDER_AUTOMATION_ENABLED=false` par défaut
- [ ] `DAILY_DIGEST_ENABLED=false` par défaut
- [ ] CRON_SECRET laissé vide (le scan horaire est interne) ; à définir uniquement si un planificateur externe appelle `/api/reminders/cron`
- [ ] aucune clé réelle versionnée dans Git

## Sécurité avant mise en production
Voir `docs/DEPLOYMENT.md` et `docs/BACKUP_RESTORE.md`.
- [ ] secrets générés pour la production (aucune valeur d’exemple) : l’API refuse de démarrer sinon
- [ ] PostgreSQL sans port publié ; ports 3000 et 4000 sur 127.0.0.1 uniquement (vérifié avec `nmap` depuis une autre machine)
- [ ] HTTPS en place, en-têtes de sécurité présents (`curl -sI`)
- [ ] `TRUST_PROXY="1"` derrière Nginx
- [ ] premier administrateur créé avec `admin:create` ; `/api/auth/registration` répond `{"open":false}`
- [ ] `npm audit --omit=dev` relu
- [ ] sauvegarde nocturne envoyée hors du serveur, restauration testée une fois
- [ ] jetons du portail masqués dans le journal d’accès Nginx
