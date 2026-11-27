import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { Role } from '@prisma/client';
import { z } from 'zod';

const router = Router();

const createDelegationSchema = z.object({
  toUserId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
});

/**
 * GET /api/delegations
 * List delegations relevant to the user (sent or received), or all for admin.
 */
router.get(
  '/',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const where: any = {};

      if (user.role !== Role.ADMINISTRATOR) {
        where.OR = [
          { fromUserId: user.id },
          { toUserId: user.id },
        ];
      }

      const delegations = await prisma.delegation.findMany({
        where,
        include: {
          fromUser: {
            select: { id: true, name: true, email: true, department: true, role: true, isAway: true },
          },
          toUser: {
            select: { id: true, name: true, email: true, department: true, role: true },
          },
          department: {
            select: { id: true, name: true, code: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      });

      return res.json({ delegations });
    } catch (err: any) {
      console.error('Error fetching delegations:', err);
      return res.status(500).json({ error: 'Failed to retrieve delegations.' });
    }
  }
);

/**
 * POST /api/delegations
 * Create a new delegation of approval authority.
 */
router.post(
  '/',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const data = createDelegationSchema.parse(req.body);

      const startsAt = new Date(data.startsAt);
      const endsAt = new Date(data.endsAt);

      if (endsAt <= startsAt) {
        return res.status(400).json({ error: 'Delegation end time must be after start time.' });
      }

      // Check delegate user exists and is at least FACULTY or DEPARTMENT_APPROVER
      const toUser = await prisma.user.findUnique({
        where: { id: data.toUserId },
      });

      if (!toUser) {
        return res.status(404).json({ error: 'Designated delegate user not found.' });
      }

      if (toUser.id === user.id) {
        return res.status(400).json({ error: 'Cannot delegate approval authority to yourself.' });
      }

      // Determine department
      let departmentId = data.departmentId;
      if (!departmentId) {
        // If not specified, look for primary assignment or user's department
        const assignment = await prisma.approverAssignment.findFirst({
          where: { userId: user.id },
        });
        if (assignment) {
          departmentId = assignment.departmentId;
        } else if (user.department) {
          const dept = await prisma.department.findFirst({
            where: {
              OR: [{ name: user.department }, { code: user.department }],
            },
          });
          departmentId = dept?.id;
        }
      }

      if (!departmentId) {
        return res.status(400).json({ error: 'Department ID could not be determined for delegation.' });
      }

      // Check department authorization
      if (user.role !== Role.ADMINISTRATOR) {
        const hasAssignment = await prisma.approverAssignment.findFirst({
          where: { userId: user.id, departmentId },
        });
        if (!hasAssignment) {
          // Check if fallback department matches
          const dept = await prisma.department.findUnique({ where: { id: departmentId } });
          if (!dept || (dept.name !== user.department && dept.code !== user.department)) {
            return res.status(403).json({ error: 'You are not authorized to delegate authority for this department.' });
          }
        }
      }

      // Check for overlapping active delegation for the same grantor and department
      const overlapping = await prisma.delegation.findFirst({
        where: {
          fromUserId: user.id,
          departmentId,
          revokedAt: null,
          OR: [
            { startsAt: { lte: startsAt }, endsAt: { gte: startsAt } },
            { startsAt: { lte: endsAt }, endsAt: { gte: endsAt } },
            { startsAt: { gte: startsAt }, endsAt: { lte: endsAt } },
          ],
        },
      });

      if (overlapping) {
        return res.status(409).json({
          error: 'An active delegation already exists for this department covering the requested time frame.',
        });
      }

      const delegation = await prisma.delegation.create({
        data: {
          fromUserId: user.id,
          toUserId: toUser.id,
          departmentId,
          startsAt,
          endsAt,
        },
        include: {
          fromUser: { select: { id: true, name: true, email: true } },
          toUser: { select: { id: true, name: true, email: true } },
          department: { select: { id: true, name: true, code: true } },
        },
      });

      // Audit log
      await prisma.auditLog.create({
        data: {
          action: 'DELEGATION_CREATED',
          userId: user.id,
          entityType: 'Delegation',
          entityId: delegation.id,
          details: `Delegated approval authority to ${toUser.name} (${toUser.email}) from ${startsAt.toISOString()} to ${endsAt.toISOString()}`,
        },
      });

      // Notify delegate
      await prisma.notification.create({
        data: {
          userId: toUser.id,
          title: 'Approval Authority Delegated to You',
          message: `${user.name} has delegated their approval authority to you until ${endsAt.toLocaleDateString()}.`,
          type: 'APPROVAL',
          link: '/approvals',
        },
      });

      return res.status(201).json({ delegation, message: 'Delegation created successfully.' });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      console.error('Error creating delegation:', err);
      return res.status(500).json({ error: 'Failed to create delegation.' });
    }
  }
);

/**
 * DELETE /api/delegations/:id/revoke (or DELETE /api/delegations/:id)
 * Revoke an active delegation.
 */
router.delete(
  '/:id',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { id } = req.params;

      const delegation = await prisma.delegation.findUnique({
        where: { id },
        include: { toUser: true, fromUser: true },
      });

      if (!delegation) {
        return res.status(404).json({ error: 'Delegation record not found.' });
      }

      if (user.role !== Role.ADMINISTRATOR && delegation.fromUserId !== user.id) {
        return res.status(403).json({ error: 'You are not authorized to revoke this delegation.' });
      }

      if (delegation.revokedAt) {
        return res.status(400).json({ error: 'Delegation has already been revoked.' });
      }

      const updated = await prisma.delegation.update({
        where: { id },
        data: { revokedAt: new Date() },
      });

      await prisma.auditLog.create({
        data: {
          action: 'DELEGATION_REVOKED',
          userId: user.id,
          entityType: 'Delegation',
          entityId: id,
          details: `Revoked delegation to ${delegation.toUser.name}`,
        },
      });

      await prisma.notification.create({
        data: {
          userId: delegation.toUserId,
          title: 'Delegated Authority Revoked',
          message: `${user.name} has revoked your delegated approval authority.`,
          type: 'SYSTEM',
        },
      });

      return res.json({ delegation: updated, message: 'Delegation revoked successfully.' });
    } catch (err: any) {
      console.error('Error revoking delegation:', err);
      return res.status(500).json({ error: 'Failed to revoke delegation.' });
    }
  }
);

/**
 * PATCH /api/delegations/away
 * Toggle Away status for the authenticated approver.
 */
router.patch(
  '/away',
  authenticateToken,
  requireRole(Role.DEPARTMENT_APPROVER, Role.ADMINISTRATOR),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const user = req.user!;
      const { isAway, awayMessage } = req.body;

      if (typeof isAway !== 'boolean') {
        return res.status(400).json({ error: 'isAway must be a boolean.' });
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: {
          isAway,
          awayMessage: isAway ? (awayMessage || 'Currently away from campus.') : null,
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          department: true,
          isAway: true,
          awayMessage: true,
        },
      });

      await prisma.auditLog.create({
        data: {
          action: isAway ? 'APPROVER_AWAY_ENABLED' : 'APPROVER_AWAY_DISABLED',
          userId: user.id,
          entityType: 'User',
          entityId: user.id,
          details: `Approver set away status to ${isAway}. Message: ${awayMessage || 'N/A'}`,
        },
      });

      return res.json({
        user: updatedUser,
        message: isAway
          ? 'Away status enabled. Inbound approvals will route to delegates or fallback.'
          : 'Away status disabled. Direct approval duties resumed.',
      });
    } catch (err: any) {
      console.error('Error updating away status:', err);
      return res.status(500).json({ error: 'Failed to update away status.' });
    }
  }
);

export default router;
