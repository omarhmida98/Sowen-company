# SOWEN V2 — Checklist avant livraison

## Installation propre
- [ ] `npm install`
- [ ] `docker compose up -d`
- [ ] créer `back/.env` depuis `back/.env.example`
- [ ] créer `front/.env.local` depuis `front/.env.example`
- [ ] `npm run db:generate`
- [ ] `npm run db:migrate`
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
- [ ] pré-contrôle IA avec et sans clé OpenAI
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
- [ ] CRON_SECRET défini avant activation
- [ ] aucune clé réelle versionnée dans Git
