-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR_TOKEN', 'PIN', 'APPROVER_OVERRIDE', 'ADMIN_OVERRIDE');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "activeCheckInTokenJti" TEXT,
ADD COLUMN     "checkInMethod" "CheckInMethod",
ADD COLUMN     "checkInOverrideReason" TEXT,
ADD COLUMN     "checkInPinHash" TEXT,
ADD COLUMN     "checkInTokenJti" TEXT,
ADD COLUMN     "checkedInById" TEXT,
ADD COLUMN     "pinFailedAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pinLockedUntil" TIMESTAMP(3),
ADD COLUMN     "venueVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN     "checkInSecretEncrypted" TEXT,
ADD COLUMN     "checkInSecretRotatedAt" TIMESTAMP(3),
ADD COLUMN     "checkInSecretVersion" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ConsumedCheckInToken" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsumedCheckInToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsumedCheckInToken_jti_key" ON "ConsumedCheckInToken"("jti");

-- CreateIndex
CREATE INDEX "ConsumedCheckInToken_bookingId_idx" ON "ConsumedCheckInToken"("bookingId");

-- CreateIndex
CREATE INDEX "ConsumedCheckInToken_expiresAt_idx" ON "ConsumedCheckInToken"("expiresAt");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
