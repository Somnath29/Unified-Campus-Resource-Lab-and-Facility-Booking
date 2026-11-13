import { Router, Response } from 'express';
import { prisma } from '../lib/prisma';
import { authenticateToken, requireRole, AuthenticatedRequest } from '../middleware/auth';
import { Role, ResourceCategory } from '@prisma/client';
import { z } from 'zod';

const router = Router();

// Only ADMINISTRATOR role can access admin routes
router.use(authenticateToken, requireRole(Role.ADMINISTRATOR));

// GET /api/admin/users
router.get('/users', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        regNo: true,
        department: true,
        designation: true,
        phone: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ users });
  } catch (err) {
    console.error('Error fetching admin users:', err);
    return res.status(500).json({ error: 'Failed to retrieve users.' });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!Object.values(Role).includes(role)) {
      return res.status(400).json({ error: 'Invalid user role provided.' });
    }

    const updated = await prisma.user.update({
      where: { id },
      data: { role },
      select: { id: true, name: true, email: true, role: true },
    });

    await prisma.auditLog.create({
      data: {
        action: 'USER_ROLE_UPDATED',
        userId: req.user!.id,
        entityType: 'User',
        entityId: id,
        details: `Updated role of ${updated.name} to ${role}`,
      },
    });

    return res.json({ user: updated, message: 'User role updated successfully.' });
  } catch (err) {
    console.error('Error updating user role:', err);
    return res.status(500).json({ error: 'Failed to update user role.' });
  }
});

// POST /api/admin/resources
router.post('/resources', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const data = req.body;

    const resource = await prisma.resource.create({
      data: {
        code: data.code,
        name: data.name,
        category: data.category as ResourceCategory,
        department: data.department || 'Central Academic Facilities',
        building: data.building,
        floor: data.floor,
        capacity: Number(data.capacity) || 30,
        amenities: Array.isArray(data.amenities) ? data.amenities : [],
        imageUrl: data.imageUrl || 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80',
        requiresApproval: Boolean(data.requiresApproval),
        isAvailableNow: true,
        isUnderMaintenance: false,
        operatingHours: data.operatingHours || '08:00 AM - 08:00 PM',
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'RESOURCE_CREATED',
        userId: req.user!.id,
        entityType: 'Resource',
        entityId: resource.id,
        details: `Created new resource ${resource.name} (${resource.code})`,
      },
    });

    return res.status(201).json({ resource, message: 'Resource created successfully.' });
  } catch (err: any) {
    console.error('Error creating resource:', err);
    return res.status(500).json({ error: err.message || 'Failed to create resource.' });
  }
});

// PUT /api/admin/resources/:id (Update details or toggle maintenance)
router.put('/resources/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const resource = await prisma.resource.update({
      where: { id },
      data: {
        name: data.name,
        capacity: data.capacity !== undefined ? Number(data.capacity) : undefined,
        amenities: data.amenities,
        isUnderMaintenance: data.isUnderMaintenance !== undefined ? Boolean(data.isUnderMaintenance) : undefined,
        maintenanceReason: data.maintenanceReason,
        requiresApproval: data.requiresApproval !== undefined ? Boolean(data.requiresApproval) : undefined,
        operatingHours: data.operatingHours,
      },
    });

    await prisma.auditLog.create({
      data: {
        action: 'RESOURCE_UPDATED',
        userId: req.user!.id,
        entityType: 'Resource',
        entityId: resource.id,
        details: `Updated resource ${resource.name}. Maintenance mode: ${resource.isUnderMaintenance}`,
      },
    });

    return res.json({ resource, message: 'Resource updated successfully.' });
  } catch (err) {
    console.error('Error updating resource:', err);
    return res.status(500).json({ error: 'Failed to update resource.' });
  }
});

// DELETE /api/admin/resources/:id
router.delete('/resources/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const resource = await prisma.resource.delete({
      where: { id },
    });

    return res.json({ message: `Resource ${resource.name} deleted successfully.` });
  } catch (err) {
    console.error('Error deleting resource:', err);
    return res.status(500).json({ error: 'Failed to delete resource.' });
  }
});

// GET /api/admin/policies
router.get('/policies', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const policies = await prisma.departmentPolicy.findMany();
    return res.json({ policies });
  } catch (err) {
    console.error('Error fetching policies:', err);
    return res.status(500).json({ error: 'Failed to retrieve department policies.' });
  }
});

// PUT /api/admin/policies/:id
router.put('/policies/:id', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const data = req.body;

    const updated = await prisma.departmentPolicy.update({
      where: { id },
      data: {
        maxAdvanceDays: data.maxAdvanceDays ? Number(data.maxAdvanceDays) : undefined,
        maxBookingHoursPerWeek: data.maxBookingHoursPerWeek ? Number(data.maxBookingHoursPerWeek) : undefined,
        autoReleaseMinutes: data.autoReleaseMinutes ? Number(data.autoReleaseMinutes) : undefined,
        requireFacultyEndorsement: data.requireFacultyEndorsement !== undefined ? Boolean(data.requireFacultyEndorsement) : undefined,
      },
    });

    return res.json({ policy: updated, message: 'Department policy updated successfully.' });
  } catch (err) {
    console.error('Error updating policy:', err);
    return res.status(500).json({ error: 'Failed to update policy.' });
  }
});

// GET /api/admin/audit-logs
router.get('/audit-logs', async (req: AuthenticatedRequest, res: Response) => {
  try {
    const logs = await prisma.auditLog.findMany({
      include: {
        user: {
          select: { name: true, email: true, role: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return res.json({ logs });
  } catch (err) {
    console.error('Error fetching audit logs:', err);
    return res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

export default router;

