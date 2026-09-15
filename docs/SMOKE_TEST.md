# Smoke test local SOWEN V2

Ouvrir deux terminaux depuis la racine.

```powershell
# Terminal 1
npm run dev:back

# Terminal 2
npm run dev:front
```

Vérifications rapides :

1. `http://localhost:4000/api/health` répond correctement.
2. `http://localhost:3000` redirige vers `/login` sans session.
3. Créer un compte de test puis ouvrir le dashboard.
4. Créer un projet vide et vérifier qu'aucune donnée fictive n'apparaît.
5. Couper le backend : le frontend doit afficher une erreur indiquant que le serveur SOWEN est inaccessible.
6. Relancer le backend et vérifier que l'application reprend normalement.
