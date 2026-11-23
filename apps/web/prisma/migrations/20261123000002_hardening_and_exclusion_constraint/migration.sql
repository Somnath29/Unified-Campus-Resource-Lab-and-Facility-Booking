-- DropForeignKey
ALTER TABLE "Booking" DROP CONSTRAINT "Booking_resourceId_fkey";

-- AlterTable
ALTER TABLE "Resource" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Booking_userId_idx" ON "Booking"("userId");

-- CreateIndex
CREATE INDEX "Booking_status_startTime_idx" ON "Booking"("status", "startTime");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- AddForeignKey
ALTER TABLE "Booking" ADD CONSTRAINT "Booking_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Create Sequence for Sequential Booking Numbers (format: LPU-YYYY-000123)
CREATE SEQUENCE IF NOT EXISTS booking_number_seq START WITH 1000 INCREMENT BY 1;

-- Enable btree_gist extension for GIST exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Exclusion constraint to guarantee at the database level that no two bookings
-- overlap in time for the same resource while status is PENDING, APPROVED, CONFIRMED, or CHECKED_IN
ALTER TABLE "Booking"
ADD CONSTRAINT "no_overlapping_bookings"
EXCLUDE USING gist (
  "resourceId" WITH =,
  tsrange("startTime", "endTime") WITH &&
)
WHERE (status IN ('PENDING', 'APPROVED', 'CONFIRMED', 'CHECKED_IN'));
