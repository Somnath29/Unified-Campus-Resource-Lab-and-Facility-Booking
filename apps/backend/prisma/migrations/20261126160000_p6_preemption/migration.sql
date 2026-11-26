-- CreateEnum
CREATE TYPE "PreemptionStatus" AS ENUM ('PENDING_ADMIN_CONFIRMATION', 'COMPLETED', 'REJECTED', 'UNDONE');

-- CreateTable
CREATE TABLE "PreemptionRecord" (
    "id" TEXT NOT NULL,
    "targetBookingId" TEXT NOT NULL,
    "bumpedBookingId" TEXT NOT NULL,
    "initiatorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requiresAdminConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "adminApproverId" TEXT,
    "adminConfirmedAt" TIMESTAMP(3),
    "status" "PreemptionStatus" NOT NULL DEFAULT 'COMPLETED',
    "canUndoUntil" TIMESTAMP(3),
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,
    "undoReason" TEXT,
    "bumpedOriginalCheckInToken" TEXT,
    "bumpedOriginalReleaseDeadline" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PreemptionRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PreemptionRecord_targetBookingId_idx" ON "PreemptionRecord"("targetBookingId");

-- CreateIndex
CREATE INDEX "PreemptionRecord_bumpedBookingId_idx" ON "PreemptionRecord"("bumpedBookingId");

-- CreateIndex
CREATE INDEX "PreemptionRecord_status_idx" ON "PreemptionRecord"("status");

-- CreateIndex
CREATE INDEX "WaitlistEntry_resourceId_priority_idx" ON "WaitlistEntry"("resourceId", "priority");

-- CreateIndex
CREATE INDEX "WaitlistEntry_userId_idx" ON "WaitlistEntry"("userId");

-- AddForeignKey
ALTER TABLE "PreemptionRecord" ADD CONSTRAINT "PreemptionRecord_targetBookingId_fkey" FOREIGN KEY ("targetBookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreemptionRecord" ADD CONSTRAINT "PreemptionRecord_bumpedBookingId_fkey" FOREIGN KEY ("bumpedBookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreemptionRecord" ADD CONSTRAINT "PreemptionRecord_initiatorId_fkey" FOREIGN KEY ("initiatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PreemptionRecord" ADD CONSTRAINT "PreemptionRecord_adminApproverId_fkey" FOREIGN KEY ("adminApproverId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
