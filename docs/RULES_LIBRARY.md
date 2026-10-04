# Rules library: upgrading an installation that already has rules

Since the per-organisation rules library, every rule belongs to exactly one organisation. The database enforces it
(`Rule.organizationId` is `NOT NULL`), and the application only ever reads the rules of the caller's organisation.

Rules created before that change were shared by all organisations and nothing in the database records who owns
them. SOWEN does not guess. The upgrade is done by two migrations:

| Migration | What it does |
|---|---|
| `20261003220000_rules_library` | Adds the organisation column, empty for existing rules. Copies the reference of the former source table onto each rule. Deletes nothing. |
| `20261003230000_rules_organization_required` | Stops if a rule has no organisation. Otherwise makes the column mandatory. |

## Installation without rules

Nothing to do: `npx prisma migrate deploy` applies both migrations.

## Installation with existing rules

`npx prisma migrate deploy` applies the first migration and stops on the second with:

```
SOWEN: N rule(s) created before the per-organisation library have no organisation. Nothing was changed and no rule was deleted.
```

Until they are attributed, these rules are kept in the database but are not visible to any organisation: they are
not listed, not searchable and never matched by a pre-control.

Run the following from the repository root, with the API stopped or not yet restarted on the new version:

1. List the rules concerned and the organisations. This changes nothing.

   ```
   npm --workspace back run rules:assign-legacy
   ```

2. Attribute them to the organisation that owns them. The organisation is always given explicitly.

   ```
   npm --workspace back run rules:assign-legacy -- --organization <organisation id>
   ```

   If the rules belong to several organisations, attribute them in groups:

   ```
   npm --workspace back run rules:assign-legacy -- --organization <organisation id> --rules <rule id>,<rule id>
   ```

   A rule that already has an organisation is never moved, and no rule is deleted.

3. Mark the stopped migration as rolled back (it changed nothing) and deploy again.

   ```
   cd back
   npx prisma migrate resolve --rolled-back 20261003230000_rules_organization_required
   npx prisma migrate deploy
   ```

A rule that should not be kept can be deactivated or deleted from the Rules page by an administrator of its
organisation once the upgrade is finished.
