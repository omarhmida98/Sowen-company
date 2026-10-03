-- CreateEnum
CREATE TYPE "ObservationReviewStatus" AS ENUM ('PENDING', 'VALIDATED', 'REJECTED');

-- AlterTable
ALTER TABLE "Observation" ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "reviewStatus" "ObservationReviewStatus",
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" TEXT;

-- Existing observations extracted from a report get a review status. One that was already sent to a company
-- has been acted on by a person, so it is recorded as validated; the others wait for review.
-- Observations created by hand keep a NULL review status.
UPDATE "Observation" o SET "reviewStatus" = 'VALIDATED'
WHERE o."reportId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "GeneratedEmail" e WHERE e."observationId" = o."id" AND e."sentAt" IS NOT NULL);

UPDATE "Observation" SET "reviewStatus" = 'PENDING'
WHERE "reportId" IS NOT NULL AND "reviewStatus" IS NULL;
