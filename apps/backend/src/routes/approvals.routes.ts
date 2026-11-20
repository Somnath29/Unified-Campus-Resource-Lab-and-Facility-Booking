import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { BookingStatus, Role, ResourceCategory } from '@prisma/client';
import {
  processApprovalAction,
  ApprovalError,
  getAuthorizedDepartmentIds,
} from '../services/approvalService';

import { AuthenticatedUser } from '../middleware/auth';

const router = Router();

/**
 * Builds Prisma where-clause conditions to enforce department authorization scoping
 * and prevents approver self-reservations from appearing in the actionable queue.
 */
function buildScopeFilter(authorizedDeptIds: string[] | null, approver?: AuthenticatedUser) {
  if (authorizedDeptIds === null) {
    return {}; // Admin has no department scope restriction
  }
  if (authorizedDeptIds.length === 0) {
    // Approver has no assigned departments - return impossible match
    return { id: '__no_access__' };
  }

  const filter: any = {
    OR: [
      { departmentId: { in: authorizedDeptIds } },
      { resource: { departmentId: { in: authorizedDeptIds } } },
    ],
  };

  if (approver && approver.role === Role.DEPARTMENT_APPROVER) {
    filter.userId = { not: approver.id };
  }

  return filter;
}

/**
 * Enriches a booking record with Requester Summary, SLA metrics, and Competing Requests.
 */
async function enrichBooking(booking: any) {
  const now = new Date();

  // 1. Requester Summary: No-shows in last 30 days & Hours used this week
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
  const startOfWeek = new Date(now);
  const day = startOfWeek.getDay();
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1); // Monday as start of week
  startOfWeek.setDate(diff);
  startOfWeek.setHours(0, 0, 0, 0);

  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999);

  const [recentNoShowCount, weeklyBookings] = await Promise.all([
    prisma.booking.count({
      where: {
        userId: booking.userId,
        status: BookingStatus.NO_SHOW,
        startTime: { gte: thirtyDaysAgo },
      },
    }),
    prisma.booking.findMany({
      where: {
        userId: booking.userId,
        status: { in: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN, BookingStatus.COMPLETED] },
        startTime: { gte: startOfWeek, lte: endOfWeek },
      },
      select: { startTime: true, endTime: true },
    }),
  ]);

  const hoursUsedThisWeek = weeklyBookings.reduce((acc, b) => {
    const duration = (new Date(b.endTime).getTime() - new Date(b.startTime).getTime()) / 3600000;
    return acc + Math.max(0, duration);
  }, 0);

  // 2. SLA Metrics
  let slaRemainingMs: number | null = null;
  let slaStatus: 'ON_TIME' | 'DUE_SOON' | 'OVERDUE' = 'ON_TIME';

  if (booking.slaDueAt) {
    const dueTime = new Date(booking.slaDueAt).getTime();
    slaRemainingMs = dueTime - now.getTime();
    if (slaRemainingMs < 0) {
      slaStatus = 'OVERDUE';
    } else if (slaRemainingMs <= 4 * 3600000) {
      slaStatus = 'DUE_SOON';
    } else {
      slaStatus = 'ON_TIME';
    }
  }

  // 3. Competing PENDING Requests for the exact same resource & overlapping window
  const competingBookings = await prisma.booking.findMany({
    where: {
      resourceId: booking.resourceId,
      id: { not: booking.id },
      status: BookingStatus.PENDING,
      startTime: { lt: booking.endTime },
      endTime: { gt: booking.startTime },
    },
    select: { id: true, bookingNumber: true, expectedAttendance: true, priority: true },
  });

  // 4. Department Policy
  let policy = null;
  if (booking.departmentId) {
    policy = await prisma.departmentPolicy.findFirst({
      where: { departmentId: booking.departmentId },
    });
  }
  if (!policy && booking.resource?.department) {
    policy = await prisma.departmentPolicy.findFirst({
      where: { department: booking.resource.department },
    });
  }

  return {
    ...booking,
    requesterSummary: {
      role: booking.user?.role || Role.STUDENT,
      recentNoShowCount,
      hoursUsedThisWeek: Math.round(hoursUsedThisWeek * 10) / 10,
    },
    sla: {
      slaDueAt: booking.slaDueAt ? booking.slaDueAt.toISOString() : null,
      remainingMs: slaRemainingMs,
      status: slaStatus,
    },
    issues: {
      hasCompetingPending: competingBookings.length > 0,
      competingCount: competingBookings.length,
      competingBookings,
    },
    policy,
  };
}

// ============================================================================
// 1. GET /api/approvals/stats - Approval Queue Metrics
// ============================================================================
router.get(
  '/stats',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const approver = req.user!;
      const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);
      const scopeFilter = buildScopeFilter(authorizedDeptIds, approver);

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

      const [pendingCount, overdueCount, approvedTodayCount, needsInfoCount, decidedBookings] = await Promise.all([
        // Pending
        prisma.booking.count({
          where: {
            ...scopeFilter,
            status: BookingStatus.PENDING,
          },
        }),
        // Overdue (Pending with slaDueAt < now)
        prisma.booking.count({
          where: {
            ...scopeFilter,
            status: BookingStatus.PENDING,
            slaDueAt: { lt: now },
          },
        }),
        // Approved today
        prisma.booking.count({
          where: {
            ...scopeFilter,
            status: { in: [BookingStatus.CONFIRMED, BookingStatus.APPROVED] },
            decidedAt: { gte: todayStart },
          },
        }),
        // Needs info
        prisma.booking.count({
          where: {
            ...scopeFilter,
            status: BookingStatus.NEEDS_INFO,
          },
        }),
        // Average decision time calculation
        prisma.booking.findMany({
          where: {
            ...scopeFilter,
            NOT: { decidedAt: null },
          },
          select: { submittedAt: true, decidedAt: true },
          take: 100,
        }),
      ]);

      let averageDecisionTimeMinutes = 0;
      if (decidedBookings.length > 0) {
        const totalMinutes = decidedBookings.reduce((sum, b) => {
          const diffMs = new Date(b.decidedAt!).getTime() - new Date(b.submittedAt).getTime();
          return sum + Math.max(0, diffMs / 60000);
        }, 0);
        averageDecisionTimeMinutes = Math.round(totalMinutes / decidedBookings.length);
      }

      return res.json({
        pending: pendingCount,
        overdue: overdueCount,
        approvedToday: approvedTodayCount,
        averageDecisionTimeMinutes,
        needsInfoCount,
      });
    } catch (err) {
      console.error('Error fetching approval stats:', err);
      return res.status(500).json({ error: 'Failed to retrieve approval statistics.' });
    }
  }
);

// ============================================================================
// 2. GET /api/approvals - Department-Scoped Queue with Filters, Search & Pagination
// ============================================================================
router.get(
  '/',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const approver = req.user!;
      const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);

      // If approver has no department assignment, return empty list immediately
      if (authorizedDeptIds !== null && authorizedDeptIds.length === 0) {
        return res.json({
          requests: [],
          total: 0,
          page: 1,
          limit: 10,
          totalPages: 0,
        });
      }

      const scopeFilter = buildScopeFilter(authorizedDeptIds, approver);

      // Parse Query Parameters
      const {
        status,
        department,
        category,
        requesterRole,
        from,
        to,
        overdue,
        search,
        sortBy = 'createdAt',
        sortOrder = 'desc',
        page = '1',
        limit = '10',
      } = req.query;

      const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
      const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 10));
      const skip = (pageNum - 1) * limitNum;

      const where: any = {
        AND: [scopeFilter],
      };

      // 1. Status Filter (default: PENDING, or specific status, or 'ALL')
      if (status && status !== 'ALL') {
        where.AND.push({ status: status as BookingStatus });
      } else if (!status) {
        where.AND.push({ status: BookingStatus.PENDING });
      }

      // 2. Specific Department Filter
      if (department) {
        where.AND.push({
          OR: [
            { departmentId: String(department) },
            { department: { name: { contains: String(department), mode: 'insensitive' } } },
            { department: { code: { equals: String(department), mode: 'insensitive' } } },
            { resource: { department: { contains: String(department), mode: 'insensitive' } } },
          ],
        });
      }

      // 3. Category Filter
      if (category) {
        where.AND.push({
          resource: { category: category as ResourceCategory },
        });
      }

      // 4. Requester Role Filter
      if (requesterRole) {
        where.AND.push({
          user: { role: requesterRole as Role },
        });
      }

      // 5. Date Range Filter
      if (from || to) {
        const dateFilter: any = {};
        if (from) dateFilter.gte = new Date(from as string);
        if (to) dateFilter.lte = new Date(to as string);
        where.AND.push({ startTime: dateFilter });
      }

      // 6. Overdue Filter
      if (overdue === 'true') {
        where.AND.push({
          slaDueAt: { lt: new Date() },
          status: BookingStatus.PENDING,
        });
      }

      // 7. Search (bookingNumber, requester name, email, regNo)
      if (search && String(search).trim() !== '') {
        const query = String(search).trim();
        where.AND.push({
          OR: [
            { bookingNumber: { contains: query, mode: 'insensitive' } },
            { user: { name: { contains: query, mode: 'insensitive' } } },
            { user: { email: { contains: query, mode: 'insensitive' } } },
            { user: { regNo: { contains: query, mode: 'insensitive' } } },
            { resource: { name: { contains: query, mode: 'insensitive' } } },
          ],
        });
      }

      // Dynamic Sorting
      let orderBy: any = {};
      const orderDirection = String(sortOrder).toLowerCase() === 'asc' ? 'asc' : 'desc';

      if (sortBy === 'priority') {
        orderBy = { priority: orderDirection };
      } else if (sortBy === 'slaDueAt') {
        orderBy = { slaDueAt: orderDirection };
      } else if (sortBy === 'startTime') {
        orderBy = { startTime: orderDirection };
      } else {
        orderBy = { createdAt: orderDirection };
      }

      // Execute Count and FindMany in parallel
      const [total, rawBookings] = await Promise.all([
        prisma.booking.count({ where }),
        prisma.booking.findMany({
          where,
          include: {
            resource: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
                regNo: true,
                department: true,
                avatarUrl: true,
                phone: true,
              },
            },
            department: true,
            comments: {
              include: {
                author: {
                  select: { id: true, name: true, role: true },
                },
              },
              orderBy: { createdAt: 'desc' },
            },
          },
          orderBy,
          skip,
          take: limitNum,
        }),
      ]);

      // Enrich items with SLA status, Competing requests, and Requester stats
      const requests = await Promise.all(rawBookings.map((b) => enrichBooking(b)));

      return res.json({
        requests,
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum),
      });
    } catch (err) {
      console.error('Error fetching approval queue:', err);
      return res.status(500).json({ error: 'Failed to retrieve approval queue.' });
    }
  }
);

// ============================================================================
// 3. GET /api/approvals/:id - Get Single Booking Request with Scoped Auth Check
// ============================================================================
router.get(
  '/:id',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const approver = req.user!;
      const authorizedDeptIds = await getAuthorizedDepartmentIds(approver);

      const booking = await prisma.booking.findUnique({
        where: { id },
        include: {
          resource: true,
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
              regNo: true,
              department: true,
              avatarUrl: true,
              phone: true,
            },
          },
          department: true,
          comments: {
            include: {
              author: {
                select: { id: true, name: true, role: true },
              },
            },
            orderBy: { createdAt: 'asc' },
          },
          approvalDecisions: {
            include: {
              approver: {
                select: { id: true, name: true, role: true },
              },
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!booking) {
        return res.status(404).json({ error: 'Booking request not found.' });
      }

      // Department Scope Authorization Check
      if (authorizedDeptIds !== null) {
        const bookingDeptId = booking.departmentId || booking.resource?.departmentId;
        const isAuthorized = bookingDeptId ? authorizedDeptIds.includes(bookingDeptId) : false;

        if (!isAuthorized) {
          return res.status(403).json({
            error: 'Forbidden: You do not have approval permissions for this department resource.',
          });
        }
      }

      const enriched = await enrichBooking(booking);
      return res.json({ request: enriched });
    } catch (err) {
      console.error('Error fetching approval request detail:', err);
      return res.status(500).json({ error: 'Failed to retrieve booking request details.' });
    }
  }
);

// ============================================================================
// 4. POST /api/approvals/:id/action - Actions via Approval Decision Engine (P3)
// ============================================================================
router.post(
  '/:id/action',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { action, notes, reason, alternateResourceId, newStartTime, newEndTime, question } = req.body;
      const approver = req.user!;

      const result = await processApprovalAction({
        bookingId: id,
        approver,
        action,
        notes,
        reason,
        alternateResourceId,
        newStartTime,
        newEndTime,
        question,
      });

      return res.json(result);
    } catch (err: any) {
      if (err instanceof ApprovalError) {
        return res.status(err.statusCode).json({ error: err.message, details: err.details });
      }
      console.error('Error processing approval action:', err);
      return res.status(500).json({ error: 'Failed to process approval action.' });
    }
  }
);

// ============================================================================
// 5. POST /api/approvals/:id/comments - Add Comment / Internal Note
// ============================================================================
router.post(
  '/:id/comments',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { id } = req.params;
      const { body, isInternal = false } = req.body;
      const approver = req.user!;

      if (!body || typeof body !== 'string' || body.trim().length === 0) {
        return res.status(400).json({ error: 'Comment body cannot be empty.' });
      }

      const comment = await prisma.bookingComment.create({
        data: {
          bookingId: id,
          authorId: approver.id,
          body: body.trim(),
          isInternal: Boolean(isInternal),
        },
        include: {
          author: {
            select: { id: true, name: true, role: true, avatarUrl: true },
          },
        },
      });

      return res.status(201).json({ comment });
    } catch (err) {
      console.error('Error posting comment:', err);
      return res.status(500).json({ error: 'Failed to post comment.' });
    }
  }
);

export default router;
