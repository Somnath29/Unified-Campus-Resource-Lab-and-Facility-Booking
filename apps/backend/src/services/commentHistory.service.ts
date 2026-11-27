import { prisma } from '../lib/prisma';
import { BookingStatus, Role } from '@prisma/client';
import { AuthenticatedUser } from '../middleware/auth';
import { ApprovalError, getAuthorizedDepartmentIds } from './approvalService';

// In-memory rate limiting map: userId -> array of timestamps (ms)
const rateLimitMap = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10; // Max 10 comments per minute

export function checkCommentRateLimit(userId: string): boolean {
  const now = Date.now();
  const timestamps = rateLimitMap.get(userId) || [];
  const validTimestamps = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (validTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateLimitMap.set(userId, validTimestamps);
    return false;
  }

  validTimestamps.push(now);
  rateLimitMap.set(userId, validTimestamps);
  return true;
}

/**
 * Basic HTML / script tag sanitization for comments.
 */
export function sanitizeComment(text: string): string {
  if (!text) return '';
  return text
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
}

/**
 * Checks if user is authorized to interact with the given booking.
 * - Requester: authorized (can view public comments, post public comments, reply to REQUEST_INFO)
 * - Approver: authorized if within department scope or active delegation
 * - Admin: global access
 */
export async function verifyBookingAccess(
  bookingId: string,
  user: AuthenticatedUser
): Promise<{ booking: any; isApproverOrAdmin: boolean; isRequester: boolean }> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      resource: true,
      user: {
        select: { id: true, name: true, email: true, department: true, role: true },
      },
      department: true,
    },
  });

  if (!booking) {
    throw new ApprovalError('Booking not found.', 404);
  }

  const isRequester = booking.userId === user.id;
  let isApproverOrAdmin = user.role === Role.ADMINISTRATOR;

  if (!isApproverOrAdmin && user.role === Role.DEPARTMENT_APPROVER) {
    const authorizedDeptIds = await getAuthorizedDepartmentIds(user);
    if (authorizedDeptIds === null) {
      isApproverOrAdmin = true;
    } else {
      const bDeptId = booking.departmentId || booking.resource.departmentId;
      if (bDeptId && authorizedDeptIds.includes(bDeptId)) {
        isApproverOrAdmin = true;
      }
    }
  }

  if (!isRequester && !isApproverOrAdmin) {
    throw new ApprovalError('You are not authorized to view or comment on this booking.', 403);
  }

  return { booking, isApproverOrAdmin, isRequester };
}

/**
 * Retrieves comments for a booking.
 * Requesters NEVER see isInternal: true comments.
 */
export async function getBookingComments(bookingId: string, user: AuthenticatedUser) {
  const { isApproverOrAdmin } = await verifyBookingAccess(bookingId, user);

  const where: any = { bookingId };
  if (!isApproverOrAdmin) {
    where.isInternal = false;
  }

  const comments = await prisma.bookingComment.findMany({
    where,
    include: {
      author: {
        select: { id: true, name: true, role: true, avatarUrl: true, department: true },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return comments;
}

/**
 * Adds a comment to a booking.
 * - Validates length (min 1, max 2000 chars)
 * - Applies rate limiting
 * - Sanitizes body
 * - Enforces that requesters cannot set isInternal: true
 * - If booking status is NEEDS_INFO and commenter is requester, transitions back to PENDING and restarts SLA clock.
 * - Generates notifications and email digest trigger.
 */
export async function addBookingComment(
  bookingId: string,
  user: AuthenticatedUser,
  body: string,
  isInternal: boolean = false
) {
  // Rate limiting
  if (!checkCommentRateLimit(user.id)) {
    throw new ApprovalError('Rate limit exceeded. Please wait a minute before posting more comments.', 429);
  }

  // Length validation
  const rawBody = (body || '').trim();
  if (rawBody.length < 1) {
    throw new ApprovalError('Comment text cannot be empty.', 400);
  }
  if (rawBody.length > 2000) {
    throw new ApprovalError('Comment text exceeds maximum length of 2000 characters.', 400);
  }

  const cleanBody = sanitizeComment(rawBody);
  if (!cleanBody) {
    throw new ApprovalError('Comment contained invalid characters.', 400);
  }

  const { booking, isApproverOrAdmin, isRequester } = await verifyBookingAccess(bookingId, user);

  // Requesters can NEVER create internal notes
  const effectiveIsInternal = isApproverOrAdmin ? Boolean(isInternal) : false;

  return await prisma.$transaction(async (tx) => {
    // 1. Create Comment
    const comment = await tx.bookingComment.create({
      data: {
        bookingId,
        authorId: user.id,
        body: cleanBody,
        isInternal: effectiveIsInternal,
      },
      include: {
        author: {
          select: { id: true, name: true, role: true, avatarUrl: true, department: true },
        },
      },
    });

    let restartedSlaDueAt: Date | null = null;
    let statusChangedToPending = false;

    // 2. If requester replies to a booking in NEEDS_INFO status:
    // Return booking to PENDING and restart SLA clock!
    if (isRequester && booking.status === BookingStatus.NEEDS_INFO) {
      statusChangedToPending = true;

      // Fetch department policy for SLA hours
      const deptName = booking.resource?.department || booking.department?.name;
      const policy = deptName
        ? await tx.departmentPolicy.findFirst({
            where: {
              OR: [
                { department: deptName },
                ...(booking.departmentId ? [{ departmentId: booking.departmentId }] : []),
              ],
            },
          })
        : null;

      const slaHours = policy?.approvalSlaHours ?? 24;
      restartedSlaDueAt = new Date(Date.now() + slaHours * 3600000);

      await tx.booking.update({
        where: { id: bookingId },
        data: {
          status: BookingStatus.PENDING,
          slaDueAt: restartedSlaDueAt,
          slaEscalated: false,
          slaEscalatedAt: null,
          approvalNotes: `Requester replied with information: "${cleanBody.slice(0, 80)}..."`,
        },
      });

      // Record ApprovalDecision transition
      await tx.approvalDecision.create({
        data: {
          bookingId,
          approverId: user.id,
          action: 'INFO_PROVIDED',
          reason: `Requester replied to clarification question: "${cleanBody}"`,
          before: { status: BookingStatus.NEEDS_INFO, slaDueAt: booking.slaDueAt },
          after: { status: BookingStatus.PENDING, slaDueAt: restartedSlaDueAt },
        },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'BOOKING_INFO_SUBMITTED',
          userId: user.id,
          entityType: 'Booking',
          entityId: bookingId,
          details: `Requester answered information request. Booking returned to PENDING and SLA clock reset (${slaHours}h).`,
        },
      });

      // Notify approvers that info was provided
      const approvers = await tx.user.findMany({
        where: { role: { in: [Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR] } },
        select: { id: true },
      });
      for (const app of approvers) {
        await tx.notification.create({
          data: {
            userId: app.id,
            title: `Clarification Provided: #${booking.bookingNumber}`,
            message: `${user.name} replied with details for ${booking.resource.name}. Status returned to PENDING.`,
            type: 'APPROVAL',
            link: '/approvals',
          },
        });
      }
    } else {
      // Normal comment audit log
      await tx.auditLog.create({
        data: {
          action: effectiveIsInternal ? 'INTERNAL_NOTE_ADDED' : 'BOOKING_COMMENT_ADDED',
          userId: user.id,
          entityType: 'Booking',
          entityId: bookingId,
          details: `${user.name} added ${effectiveIsInternal ? 'an internal note' : 'a comment'}: "${cleanBody.slice(0, 100)}"`,
        },
      });

      // Notifications on new comment
      if (!effectiveIsInternal) {
        // If approver comments, notify requester
        if (isApproverOrAdmin && booking.userId !== user.id) {
          await tx.notification.create({
            data: {
              userId: booking.userId,
              title: `New Comment on Booking #${booking.bookingNumber}`,
              message: `${user.name} commented on your request: "${cleanBody.slice(0, 80)}"`,
              type: 'BOOKING',
              link: '/my-bookings',
            },
          });
        } else if (isRequester) {
          // If requester comments, notify approvers
          const approvers = await tx.user.findMany({
            where: { role: { in: [Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR] } },
            select: { id: true },
          });
          for (const app of approvers) {
            await tx.notification.create({
              data: {
                userId: app.id,
                title: `New Requester Note on #${booking.bookingNumber}`,
                message: `${user.name} commented: "${cleanBody.slice(0, 80)}"`,
                type: 'APPROVAL',
                link: '/approvals',
              },
            });
          }
        }
      }
    }

    return {
      comment,
      statusChangedToPending,
      restartedSlaDueAt,
    };
  });
}

/**
 * Builds unified timeline of decisions, status updates, and audit events.
 * Strips internal details if requester.
 */
export async function getBookingHistory(bookingId: string, user: AuthenticatedUser) {
  const { booking, isApproverOrAdmin } = await verifyBookingAccess(bookingId, user);

  const [decisions, auditLogs] = await Promise.all([
    prisma.approvalDecision.findMany({
      where: { bookingId },
      include: {
        approver: {
          select: { id: true, name: true, role: true, avatarUrl: true, department: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.auditLog.findMany({
      where: {
        entityType: 'Booking',
        entityId: bookingId,
      },
      include: {
        user: {
          select: { id: true, name: true, role: true, avatarUrl: true, department: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  // Combine into chronological timeline items
  const timeline: Array<{
    id: string;
    type: 'DECISION' | 'AUDIT';
    action: string;
    actor: { id: string; name: string; role: string; avatarUrl?: string | null } | null;
    timestamp: Date;
    reason?: string | null;
    before?: any;
    after?: any;
    details?: string | null;
  }> = [];

  decisions.forEach((d) => {
    timeline.push({
      id: `decision-${d.id}`,
      type: 'DECISION',
      action: d.action,
      actor: d.approver,
      timestamp: d.createdAt,
      reason: d.reason,
      before: d.before,
      after: d.after,
      details: null,
    });
  });

  auditLogs.forEach((a) => {
    // Hide internal audit actions from requesters if marked internal
    if (!isApproverOrAdmin && (a.action === 'INTERNAL_NOTE_ADDED' || a.details?.includes('internal note'))) {
      return;
    }
    timeline.push({
      id: `audit-${a.id}`,
      type: 'AUDIT',
      action: a.action,
      actor: a.user,
      timestamp: a.createdAt,
      reason: null,
      before: null,
      after: null,
      details: a.details,
    });
  });

  // Sort timeline newest to oldest
  timeline.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return {
    bookingId,
    bookingNumber: booking.bookingNumber,
    timeline,
  };
}
