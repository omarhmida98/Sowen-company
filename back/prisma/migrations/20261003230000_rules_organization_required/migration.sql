-- Every rule must belong to an organisation.
-- Rules created before the per-organisation library have no owner and SOWEN does not guess one. If any exist, this
-- migration stops without changing anything, and an operator attributes them explicitly (see docs/RULES_LIBRARY.md).
DO $$
DECLARE
  unscoped integer;
BEGIN
  SELECT count(*) INTO unscoped FROM "Rule" WHERE "organizationId" IS NULL;
  IF unscoped > 0 THEN
    RAISE EXCEPTION 'SOWEN: % rule(s) created before the per-organisation library have no organisation. Nothing was changed and no rule was deleted.', unscoped
      USING HINT = 'List them with "npm --workspace back run rules:assign-legacy", attribute them with "npm --workspace back run rules:assign-legacy -- --organization <organisation id>", then run "npx prisma migrate resolve --rolled-back 20261003230000_rules_organization_required" and "npx prisma migrate deploy" again. See docs/RULES_LIBRARY.md.';
  END IF;
END $$;

-- AlterTable: from here on the database itself refuses a rule without an organisation
ALTER TABLE "Rule" ALTER COLUMN "organizationId" SET NOT NULL;
