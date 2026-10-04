-- AlterTable: rules belong to an organisation and carry their own reference
ALTER TABLE "Rule" ADD COLUMN     "organizationId" TEXT,
ADD COLUMN     "reference" TEXT,
ADD COLUMN     "sourceDocument" TEXT;

-- Rules that existed before were shared by every organisation and nothing records who owns them.
-- Their organisation is deliberately left empty here: it is never guessed. The next migration
-- (rules_organization_required) refuses to run until an operator has attributed them explicitly.

-- The reference used to live in the separate source table: copy it onto the rule.
UPDATE "Rule" r SET "reference" = s."reference", "sourceDocument" = s."title"
FROM "RuleSource" s WHERE r."sourceId" = s."id" AND r."reference" IS NULL;

-- AlterTable: an observation created from a pre-control keeps a link to its rule
ALTER TABLE "Observation" ADD COLUMN     "ruleId" TEXT;

-- CreateIndex
CREATE INDEX "Rule_organizationId_active_idx" ON "Rule"("organizationId", "active");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Observation" ADD CONSTRAINT "Observation_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "Rule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
