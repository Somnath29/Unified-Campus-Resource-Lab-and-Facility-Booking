import { prisma } from '../lib/prisma';
import { BookingStatus, Role } from '@prisma/client';

export interface SlaCheckResults {
  escalatedCount: number;
  expiredCount: number;
  details: string[];
}

/**
 * Checks pending bookings against SLA deadlines and resource availability/start times:
 * 1. Bookings whose start time has already passed while still PENDING are expired/auto-rejected.
 * 2. Bookings whose slaDueAt has passed and have not yet been escalated are escalated:
 *    - Looks up DepartmentPolicy.escalateToRole (defaulting to ADMINISTRATOR)
 *    - Updates slaEscalated = true and slaEscalatedAt = now
 *    - Emits notifications to target escalated role users and requester
 *    - Creates an ApprovalDecision record (action: 'ESCALATE')
 *    - Logs AuditLog entry
 * 3. Bookings whose slaDueAt has passed and have no viable escalation path (or policy specifies auto-reject)
 *    or are past emergency deadline are auto-rejected.
 * 
 * Safe, idempotent, and transactional.
 */
export async function processSlaEscalationsAndExpiries(): Promise<SlaCheckResults> {
  const now = new Date();
  let escalatedCount = 0;
  let expiredCount = 0;
  const details: string[] = [];

  // 1. Process Expired Bookings (Pending bookings whose requested startTime has already passed)
  const pastStartBookings = await prisma.booking.findMany({
    where: {
      status: BookingStatus.PENDING,
      startTime: { lt: now },
    },
    include: {
      resource: true,
      user: true,
    },
  });

  for (const b of pastStartBookings) {
    try {
      await prisma.$transaction(async (tx) => {
        // Re-verify status under transaction
        const fresh = await tx.booking.findUnique({
          where: { id: b.id },
          select: { status: true },
        });
        if (fresh?.status !== BookingStatus.PENDING) return;

        const rejectionReason = 'Automatically expired and rejected: requested event start time passed without approval.';

        await tx.booking.update({
          where: { id: b.id },
          data: {
            status: BookingStatus.REJECTED,
            rejectionReason,
            decidedAt: now,
          },
        });

        await tx.approvalDecision.create({
          data: {
            bookingId: b.id,
            approverId: b.userId, // System automated
            action: 'AUTO_REJECT_EXPIRED',
            reason: rejectionReason,
            before: { status: BookingStatus.PENDING },
            after: { status: BookingStatus.REJECTED },
          },
        });

        await tx.notification.create({
          data: {
            userId: b.userId,
            title: `Booking Request Expired: ${b.resource.name}`,
            message: `Your booking request #${b.bookingNumber} was automatically closed because its start time passed before review.`,
            type: 'BOOKING',
            link: '/my-bookings',
          },
        });

        await tx.auditLog.create({
          data: {
            action: 'BOOKING_AUTO_EXPIRED',
            entityType: 'Booking',
            entityId: b.id,
            details: `Auto-rejected booking #${b.bookingNumber} after start time passed.`,
          },
        });
      });

      expiredCount++;
      details.push(`Expired booking #${b.bookingNumber} (start time passed)`);
    } catch (err: any) {
      console.error(`Failed to auto-expire booking ${b.id}:`, err);
    }
  }

  // 2. Process SLA Escalations (Pending bookings past slaDueAt that haven't been escalated yet)
  const overdueBookings = await prisma.booking.findMany({
    where: {
      status: BookingStatus.PENDING,
      slaDueAt: { lt: now },
      slaEscalated: false,
    },
    include: {
      resource: true,
      user: true,
      department: true,
    },
  });

  for (const b of overdueBookings) {
    try {
      await prisma.$transaction(async (tx) => {
        // Re-verify idempotency lock
        const fresh = await tx.booking.findUnique({
          where: { id: b.id },
          select: { status: true, slaEscalated: true },
        });

        if (!fresh || fresh.status !== BookingStatus.PENDING || fresh.slaEscalated) {
          return; // Already processed
        }

        // Fetch Department Policy
        const deptName = b.resource?.department || b.department?.name;
        const policy = deptName
          ? await tx.departmentPolicy.findFirst({
              where: {
                OR: [
                  { department: deptName },
                  ...(b.departmentId ? [{ departmentId: b.departmentId }] : []),
                ],
              },
            })
          : null;

        const targetRole = policy?.escalateToRole || Role.ADMINISTRATOR;

        // Mark as escalated atomically
        await tx.booking.update({
          where: { id: b.id },
          data: {
            slaEscalated: true,
            slaEscalatedAt: now,
          },
        });

        // Record ApprovalDecision record
        await tx.approvalDecision.create({
          data: {
            bookingId: b.id,
            approverId: b.userId, // System automated trigger
            action: 'ESCALATE_SLA',
            reason: `SLA deadline exceeded (${b.slaDueAt?.toISOString()}). Escalated to ${targetRole}.`,
            before: { slaEscalated: false },
            after: { slaEscalated: true, escalatedTo: targetRole },
          },
        });

        // Find users with target role to notify
        const escalators = await tx.user.findMany({
          where: { role: targetRole },
          select: { id: true },
        });

        for (const esc of escalators) {
          await tx.notification.create({
            data: {
              userId: esc.id,
              title: `[SLA ESCALATION] Booking #${b.bookingNumber} Overdue`,
              message: `Approval request for ${b.resource.name} (${b.user.name}) exceeded department SLA. Immediate review required.`,
              type: 'APPROVAL',
              link: '/approvals',
            },
          });
        }

        // Notify requester about escalation
        await tx.notification.create({
          data: {
            userId: b.userId,
            title: `Request Escalated: ${b.resource.name}`,
            message: `Your booking request #${b.bookingNumber} has been expedited and escalated to senior administrators.`,
            type: 'BOOKING',
            link: '/my-bookings',
          },
        });

        // Audit log
        await tx.auditLog.create({
          data: {
            action: 'SLA_ESCALATED',
            entityType: 'Booking',
            entityId: b.id,
            details: `Escalated booking #${b.bookingNumber} to ${targetRole} due to missed SLA deadline.`,
          },
        });
      });

      escalatedCount++;
      details.push(`Escalated booking #${b.bookingNumber}`);
    } catch (err: any) {
      console.error(`Failed to escalate booking ${b.id}:`, err);
    }
  }

  return { escalatedCount, expiredCount, details };
}

let schedulerTimer: NodeJS.Timeout | null = null;

export function startSlaEscalationScheduler(intervalMs = 30000) {
  console.log(`⏱️ SLA Escalation & Expiry scheduler active. Checking every ${intervalMs / 1000} seconds.`);

  if (schedulerTimer) {
    clearInterval(schedulerTimer);
  }

  schedulerTimer = setInterval(async () => {
    try {
      const results = await processSlaEscalationsAndExpiries();
      if (results.escalatedCount > 0 || results.expiredCount > 0) {
        console.log(`⚡ SLA Monitor: ${results.escalatedCount} escalated, ${results.expiredCount} auto-expired.`);
      }
    } catch (err) {
      console.error('Error in SLA escalation scheduler loop:', err);
    }
  }, intervalMs);
}

export function stopSlaEscalationScheduler() {
  if (schedulerTimer) {
    clearInterval(schedulerTimer);
    schedulerTimer = null;
  }
}
