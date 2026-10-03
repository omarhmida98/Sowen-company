-- CreateEnum
CREATE TYPE "ResponseSource" AS ENUM ('PORTAL', 'INTERNAL');

-- Company portal links are now signed by the server instead of being stored: the plaintext token column goes.
-- Links issued before this migration stop working; an access keeps its row and a new link is available internally.
DROP INDEX "CompanyPortalAccess_token_key";
ALTER TABLE "CompanyPortalAccess" DROP COLUMN "token",
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "revokedById" TEXT;

-- AlterTable: who closed an observation, when, and why
ALTER TABLE "Observation" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT,
ADD COLUMN     "closureNote" TEXT;

-- CreateTable
CREATE TABLE "ObservationResponse" (
    "id" TEXT NOT NULL,
    "observationId" TEXT NOT NULL,
    "source" "ResponseSource" NOT NULL,
    "message" TEXT NOT NULL,
    "companyId" TEXT,
    "portalAccessId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObservationResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObservationResponse_observationId_createdAt_idx" ON "ObservationResponse"("observationId", "createdAt");

-- AddForeignKey
ALTER TABLE "ObservationResponse" ADD CONSTRAINT "ObservationResponse_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "Observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
