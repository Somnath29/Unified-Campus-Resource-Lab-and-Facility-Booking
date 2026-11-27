import { prisma } from '@/lib/prisma';
import {
  Prisma,
  Role,
  BookingStatus,
  WaitlistStatus,
  ActivityType,
  PriorityLevel,
} from '@prisma/client';
import { ApiError } from '@/lib/auth';
import { BookingUserContext, BookingService } from '@/services/bookingService';
import {
  formatKolkataDateTime,
  validateOperatingHours,
  getDayOfWeekInKolkata,
} from '@/lib/timezone';
import {
  WaitlistEntryDTO,
  JoinWaitlistRequest,
  JoinWaitlistResponse,
  WaitlistQuery,
  WaitlistListResponse,
  AcceptOfferResponse,
  LeaveWaitlistResponse,
  WaitlistExpiryJobResponse,
} from '@lpu/shared';

/**
 * Returns deterministic server-assigned priority based on user role and policy.
 * Priority is strictly server-controlled and never accepted from client inputs.
 */
export function getWaitlistPriority(user: { role: Role; department?: string }): number {
  switch (user.role) {
    case Role.ADMINISTRATOR:
      return 100;
    case Role.FACULTY:
      return 50;
    case Role.DEPARTMENT_APPROVER:
      return 40;
    case Role.STUDENT:
    default:
      return 10;
  }
}

/**
 * Generates a deterministic string identifier for PostgreSQL transaction-scoped advisory locks.
 */
export function getWaitlistLockString(resourceId: string, startTime: Date, endTime: Date): string {
  return `waitlist_${resourceId}_${startTime.toISOString()}_${endTime.toISOString()}`;
}

/**
 * Maps a Prisma WaitlistEntry to WaitlistEntryDTO with calculated queue attributes.
 */
export async function mapWaitlistEntryToDTO(
  entry: any,
  now = new Date()
): Promise<WaitlistEntryDTO> {
  let queuePosition: number | null = null;
  let isOfferActive = false;
  let offerRemainingSeconds: number | null = null;

  if (entry.status === WaitlistStatus.WAITING) {
    // Count how many eligible entries are ahead in line
    const ahead = await prisma.waitlistEntry.count({
      where: {
        resourceId: entry.resourceId,
        startTime: entry.startTime,
        endTime: entry.endTime,
        status: WaitlistStatus.WAITING,
        OR: [
          { priority: { gt: entry.priority } },
          {
            AND: [
              { priority: entry.priority },
              { createdAt: { lt: entry.createdAt } },
            ],
          },
          {
            AND: [
              { priority: entry.priority },
              { createdAt: entry.createdAt },
              { id: { lte: entry.id } },
            ],
          },
        ],
      },
    });
    queuePosition = Math.max(1, ahead);
  } else if (entry.status === WaitlistStatus.OFFERED) {
    if (entry.offerExpiresAt) {
      const expires = new Date(entry.offerExpiresAt);
      if (expires > now) {
        isOfferActive = true;
        offerRemainingSeconds = Math.max(0, Math.floor((expires.getTime() - now.getTime()) / 1000));
      }
    }
  }

  return {
    id: entry.id,
    userId: entry.userId,
    resourceId: entry.resourceId,
    startTime: entry.startTime.toISOString(),
    endTime: entry.endTime.toISOString(),
    priority: entry.priority,
    status: entry.status,
    offeredAt: entry.offeredAt ? entry.offeredAt.toISOString() : null,
    offerExpiresAt: entry.offerExpiresAt ? entry.offerExpiresAt.toISOString() : null,
    bookingId: entry.bookingId || null,
    withdrawnAt: entry.withdrawnAt ? entry.withdrawnAt.toISOString() : null,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
    resource: entry.resource
      ? {
          id: entry.resource.id,
          name: entry.resource.name,
          code: entry.resource.code,
          building: entry.resource.building,
          floor: entry.resource.floor || null,
          capacity: entry.resource.capacity,
          imageUrl: entry.resource.imageUrl || null,
          operatingHours: entry.resource.operatingHours,
        }
      : undefined,
    queuePosition,
    isOfferActive,
    offerRemainingSeconds,
  };
}

export class WaitlistService {
  /**
   * Adds an authenticated user to the queue for a booked resource slot.
   */
  static async joinWaitlist({
    user,
    input,
  }: {
    user: BookingUserContext;
    input: JoinWaitlistRequest;
  }): Promise<JoinWaitlistResponse> {
    const start = new Date(input.startTime);
    const end = new Date(input.endTime);

    // 1. Time range & duration validations
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new ApiError(400, 'Invalid start or end time format.');
    }

    if (end <= start) {
      throw new ApiError(400, 'End time must be strictly after start time.');
    }

    const durationMinutes = (end.getTime() - start.getTime()) / (1000 * 60);
    if (durationMinutes < 15) {
      throw new ApiError(400, 'Minimum waitlist duration is 15 minutes.');
    }

    if (durationMinutes / 60 > 8) {
      throw new ApiError(400, 'Maximum single waitlist slot duration is 8 hours.');
    }

    // 2. Resource existence & maintenance validation
    const resource = await prisma.resource.findUnique({
      where: { id: input.resourceId },
    });

    if (!resource || resource.deletedAt !== null) {
      throw new ApiError(404, 'Selected resource does not exist or has been archived.');
    }

    if (resource.isUnderMaintenance) {
      throw new ApiError(
        400,
        `Cannot join waitlist: Resource is under maintenance. (${resource.maintenanceReason || 'Scheduled maintenance'})`
      );
    }

    // 3. Operating hours validation
    const opCheck = validateOperatingHours(start, end, resource.operatingHours);
    if (!opCheck.valid) {
      throw new ApiError(400, opCheck.reason || 'Requested waitlist slot is outside resource operating hours.');
    }

    // 4. Timetable / class conflict validation
    const dayOfWeek = getDayOfWeekInKolkata(start);
    const startHH = String(start.getUTCHours() + 5 + (start.getUTCMinutes() + 30 >= 60 ? 1 : 0)).padStart(2, '0');
    // Compute local Kolkata HH:MM
    const kolkataDate = new Date(start.getTime() + (5.5 * 60 * 60 * 1000));
    const kolkataEnd = new Date(end.getTime() + (5.5 * 60 * 60 * 1000));
    const startHHMM = `${String(kolkataDate.getUTCHours()).padStart(2, '0')}:${String(kolkataDate.getUTCMinutes()).padStart(2, '0')}`;
    const endHHMM = `${String(kolkataEnd.getUTCHours()).padStart(2, '0')}:${String(kolkataEnd.getUTCMinutes()).padStart(2, '0')}`;

    const timetableClash = await prisma.timetableEntry.findFirst({
      where: {
        resourceId: resource.id,
        dayOfWeek,
        AND: [
          { startTime: { lt: endHHMM } },
          { endTime: { gt: startHHMM } },
        ],
      },
    });

    if (timetableClash) {
      throw new ApiError(
        400,
        `Cannot join waitlist: Slot is unavailable due to an academic timetable class (${timetableClash.courseCode}: ${timetableClash.courseName}).`
      );
    }

    // 5. Blackout period validation (via DepartmentPolicy)
    const policy = await prisma.departmentPolicy.findUnique({
      where: { department: resource.department },
    });
    if (policy?.blackoutPeriods) {
      try {
        const blackouts = JSON.parse(policy.blackoutPeriods);
        if (Array.isArray(blackouts)) {
          const slotOverlap = blackouts.some((bo: { start: string; end: string }) => {
            const boStart = new Date(bo.start);
            const boEnd = new Date(bo.end);
            return start < boEnd && end > boStart;
          });
          if (slotOverlap) {
            throw new ApiError(400, 'Cannot join waitlist: Slot falls within a department blackout period.');
          }
        }
      } catch (err: any) {
        if (err instanceof ApiError) throw err;
      }
    }

    // 6. Check that slot is currently occupied by an active booking
    const activeBooking = await prisma.booking.findFirst({
      where: {
        resourceId: resource.id,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        AND: [
          { startTime: { lt: end } },
          { endTime: { gt: start } },
        ],
      },
    });

    if (!activeBooking) {
      throw new ApiError(
        400,
        'This time slot is currently available. Please proceed to book it directly rather than joining the waitlist.'
      );
    }

    // 7. Check if user already has an active waitlist entry for the exact slot
    const existingWaitlist = await prisma.waitlistEntry.findFirst({
      where: {
        userId: user.id,
        resourceId: resource.id,
        startTime: start,
        endTime: end,
        status: { in: [WaitlistStatus.WAITING, WaitlistStatus.OFFERED] },
      },
    });

    if (existingWaitlist) {
      throw new ApiError(409, 'You already have an active waitlist entry for this exact resource and time slot.');
    }

    // 8. Check if user already has an active booking that overlaps with this slot
    const userBookingClash = await prisma.booking.findFirst({
      where: {
        userId: user.id,
        status: {
          in: [
            BookingStatus.PENDING,
            BookingStatus.APPROVED,
            BookingStatus.CONFIRMED,
            BookingStatus.CHECKED_IN,
          ],
        },
        AND: [
          { startTime: { lt: end } },
          { endTime: { gt: start } },
        ],
      },
    });

    if (userBookingClash) {
      throw new ApiError(
        409,
        `You already have an active booking (#${userBookingClash.bookingNumber}) overlapping with this time interval.`
      );
    }

    // 9. Assign server-controlled priority and create entry
    const priority = getWaitlistPriority(user);

    const entry = await prisma.$transaction(async (tx) => {
      const created = await tx.waitlistEntry.create({
        data: {
          userId: user.id,
          resourceId: resource.id,
          startTime: start,
          endTime: end,
          priority,
          status: WaitlistStatus.WAITING,
        },
        include: { resource: true },
      });

      // Audit Log
      await tx.auditLog.create({
        data: {
          action: 'WAITLIST_JOINED',
          userId: user.id,
          entityType: 'WaitlistEntry',
          entityId: created.id,
          details: JSON.stringify({
            resourceId: resource.id,
            resourceName: resource.name,
            startTime: created.startTime,
            endTime: created.endTime,
            priority,
          }),
        },
      });

      return created;
    });

    // 10. Queue position calculation & notification
    const dto = await mapWaitlistEntryToDTO(entry);

    try {
      await prisma.notification.create({
        data: {
          userId: user.id,
          title: `Joined Waitlist: ${resource.name}`,
          message: `You are #${dto.queuePosition} in line for ${resource.name} on ${formatKolkataDateTime(start)}.`,
          type: 'BOOKING',
          link: '/my-bookings?tab=WAITLIST',
        },
      });
    } catch {}

    return {
      entry: dto,
      queuePosition: dto.queuePosition || 1,
      message: `Successfully joined waitlist. Your position: #${dto.queuePosition || 1}.`,
    };
  }

  /**
   * Leaves or declines a waitlist entry.
   * If OFFERED, immediately attempts to promote the next user in queue.
   */
  static async leaveWaitlist({
    id,
    user,
  }: {
    id: string;
    user: BookingUserContext;
  }): Promise<LeaveWaitlistResponse> {
    const entry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!entry) {
      throw new ApiError(404, 'Waitlist entry not found.');
    }

    // Ownership check
    const isOwner = entry.userId === user.id;
    const isAdmin = user.role === Role.ADMINISTRATOR;
    if (!isOwner && !isAdmin) {
      throw new ApiError(403, 'Unauthorized to withdraw this waitlist entry.');
    }

    if (entry.status === WaitlistStatus.FULFILLED) {
      throw new ApiError(409, 'Cannot withdraw a fulfilled waitlist entry that has already been converted to a booking.');
    }

    if (entry.status === WaitlistStatus.WITHDRAWN) {
      const dto = await mapWaitlistEntryToDTO(entry);
      return {
        waitlistEntry: dto,
        promotedNextUser: false,
        message: 'Waitlist entry was already withdrawn.',
      };
    }

    const wasOffered = entry.status === WaitlistStatus.OFFERED;
    const lockKey = getWaitlistLockString(entry.resourceId, entry.startTime, entry.endTime);

    const updated = await prisma.$transaction(async (tx) => {
      // Transaction-scoped advisory lock for the slot
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

      const current = await tx.waitlistEntry.findUnique({ where: { id } });
      if (!current || current.status === WaitlistStatus.FULFILLED) {
        throw new ApiError(409, 'Waitlist entry status changed. Cannot withdraw.');
      }

      const res = await tx.waitlistEntry.update({
        where: { id },
        data: {
          status: WaitlistStatus.WITHDRAWN,
          withdrawnAt: new Date(),
        },
        include: { resource: true },
      });

      await tx.auditLog.create({
        data: {
          action: wasOffered ? 'WAITLIST_OFFER_DECLINED' : 'WAITLIST_WITHDRAWN',
          userId: user.id,
          entityType: 'WaitlistEntry',
          entityId: id,
          details: JSON.stringify({
            resourceId: entry.resourceId,
            resourceName: entry.resource.name,
            startTime: entry.startTime,
            endTime: entry.endTime,
            previousStatus: entry.status,
          }),
        },
      });

      return res;
    });

    let promotedNextUser = false;
    if (wasOffered) {
      // Immediately promote next eligible user for the freed slot
      const nextOffer = await WaitlistService.triggerSlotOffer({
        resourceId: entry.resourceId,
        startTime: entry.startTime,
        endTime: entry.endTime,
      });
      promotedNextUser = !!nextOffer;
    }

    const dto = await mapWaitlistEntryToDTO(updated);
    return {
      waitlistEntry: dto,
      promotedNextUser,
      message: wasOffered
        ? 'Offer declined. The slot has been offered to the next user in line.'
        : 'Successfully withdrawn from waitlist.',
    };
  }

  /**
   * Retrieves paginated waitlist entries for the authenticated user.
   */
  static async getUserWaitlist({
    user,
    query,
  }: {
    user: BookingUserContext;
    query: WaitlistQuery;
  }): Promise<WaitlistListResponse> {
    const page = Math.max(1, query.page || 1);
    const limit = Math.min(50, Math.max(1, query.limit || 10));
    const skip = (page - 1) * limit;

    const where: Prisma.WaitlistEntryWhereInput = {
      userId: user.id,
    };

    if (query.status) {
      where.status = query.status;
    }

    const [total, entries, activeOfferCount] = await Promise.all([
      prisma.waitlistEntry.count({ where }),
      prisma.waitlistEntry.findMany({
        where,
        include: { resource: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.waitlistEntry.count({
        where: {
          userId: user.id,
          status: WaitlistStatus.OFFERED,
          offerExpiresAt: { gt: new Date() },
        },
      }),
    ]);

    const mappedEntries = await Promise.all(
      entries.map((entry) => mapWaitlistEntryToDTO(entry))
    );

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return {
      entries: mappedEntries,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
      activeOfferCount,
    };
  }

  /**
   * Automatically attempts to offer a released slot to the next waiting user.
   * Uses PostgreSQL transaction-scoped advisory locking to prevent duplicate offers.
   */
  static async triggerSlotOffer({
    resourceId,
    startTime,
    endTime,
  }: {
    resourceId: string;
    startTime: Date;
    endTime: Date;
  }): Promise<any | null> {
    const lockKey = getWaitlistLockString(resourceId, startTime, endTime);

    try {
      const offeredEntry = await prisma.$transaction(
        async (tx) => {
          // 1. Acquire transaction-scoped advisory lock for the slot
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

          // 2. Recheck slot availability: ensure no active booking exists
          const existingBooking = await tx.booking.findFirst({
            where: {
              resourceId,
              status: {
                in: [
                  BookingStatus.PENDING,
                  BookingStatus.APPROVED,
                  BookingStatus.CONFIRMED,
                  BookingStatus.CHECKED_IN,
                ],
              },
              AND: [
                { startTime: { lt: endTime } },
                { endTime: { gt: startTime } },
              ],
            },
          });

          if (existingBooking) {
            // Slot is occupied; cannot offer to waitlist
            return null;
          }

          // 3. Ensure no active OFFERED entry already exists for this exact slot
          const existingActiveOffer = await tx.waitlistEntry.findFirst({
            where: {
              resourceId,
              startTime,
              endTime,
              status: WaitlistStatus.OFFERED,
              offerExpiresAt: { gt: new Date() },
            },
          });

          if (existingActiveOffer) {
            // An active offer is already pending response
            return null;
          }

          // 4. Retrieve next eligible WAITING entry ordered by priority DESC, createdAt ASC, id ASC
          const nextEntry = await tx.waitlistEntry.findFirst({
            where: {
              resourceId,
              startTime,
              endTime,
              status: WaitlistStatus.WAITING,
            },
            orderBy: [
              { priority: 'desc' },
              { createdAt: 'asc' },
              { id: 'asc' },
            ],
            include: { user: true, resource: true },
          });

          if (!nextEntry) {
            return null;
          }

          // 5. Update entry to OFFERED with 15-minute expiry
          const now = new Date();
          const offerExpiresAt = new Date(now.getTime() + 15 * 60 * 1000);

          const updated = await tx.waitlistEntry.update({
            where: { id: nextEntry.id },
            data: {
              status: WaitlistStatus.OFFERED,
              offeredAt: now,
              offerExpiresAt,
            },
            include: { resource: true, user: true },
          });

          // 6. Record Audit Log
          await tx.auditLog.create({
            data: {
              action: 'WAITLIST_OFFERED',
              userId: nextEntry.userId,
              entityType: 'WaitlistEntry',
              entityId: nextEntry.id,
              details: JSON.stringify({
                resourceId,
                resourceName: nextEntry.resource.name,
                startTime,
                endTime,
                offeredAt: now,
                offerExpiresAt,
                priority: nextEntry.priority,
              }),
            },
          });

          // 7. Send notification to the chosen user
          await tx.notification.create({
            data: {
              userId: nextEntry.userId,
              title: `Slot Available: ${nextEntry.resource.name}`,
              message: `A slot you requested for ${nextEntry.resource.name} on ${formatKolkataDateTime(startTime)} is now available! You have 15 minutes to accept this offer before it expires.`,
              type: 'BOOKING',
              link: '/my-bookings?tab=WAITLIST',
            },
          });

          return updated;
        },
        {
          maxWait: 15000,
          timeout: 30000,
        }
      );

      if (offeredEntry) {
        try {
          const { dispatchEventEmail } = await import('@/services/reminderService');
          await dispatchEventEmail({
            userId: offeredEntry.user.id,
            userEmail: offeredEntry.user.email,
            userName: offeredEntry.user.name,
            bookingId: offeredEntry.id,
            notificationType: 'WAITLIST_OFFER',
            templateKind: 'waitlist_offer',
            scheduledFor: offeredEntry.offeredAt || new Date(),
            resourceName: offeredEntry.resource.name,
            building: offeredEntry.resource.building,
            startTime: offeredEntry.startTime,
            endTime: offeredEntry.endTime,
            actionPath: '/my-bookings?tab=WAITLIST',
          });
        } catch {}
      }

      return offeredEntry;
    } catch (err: any) {
      console.error('[WaitlistService.triggerSlotOffer Error]', err);
      return null;
    }
  }

  /**
   * Accepts an active waitlist offer and atomically creates the booking.
   * Uses PostgreSQL advisory locks and serializes booking creation to prevent double booking.
   */
  static async acceptOffer({
    id,
    user,
  }: {
    id: string;
    user: BookingUserContext;
  }): Promise<AcceptOfferResponse> {
    const entry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { resource: true },
    });

    if (!entry) {
      throw new ApiError(404, 'Waitlist entry not found.');
    }

    // Ownership check
    if (entry.userId !== user.id) {
      throw new ApiError(403, 'Unauthorized: You do not own this waitlist offer.');
    }

    if (entry.status !== WaitlistStatus.OFFERED) {
      throw new ApiError(
        409,
        `Cannot accept offer: Entry is not in OFFERED status (Current status: ${entry.status}).`
      );
    }

    const now = new Date();
    if (entry.offerExpiresAt && entry.offerExpiresAt < now) {
      // Mark expired
      await prisma.waitlistEntry.update({
        where: { id },
        data: { status: WaitlistStatus.EXPIRED },
      });
      // Promote next user
      WaitlistService.triggerSlotOffer({
        resourceId: entry.resourceId,
        startTime: entry.startTime,
        endTime: entry.endTime,
      }).catch(() => {});

      throw new ApiError(409, 'This waitlist offer has expired and can no longer be accepted.');
    }

    const lockKey = getWaitlistLockString(entry.resourceId, entry.startTime, entry.endTime);

    // Atomically fulfill waitlist entry and create booking in a single transaction
    const bookingResult = await prisma.$transaction(
      async (tx) => {
        // 1. Acquire transaction-scoped advisory lock
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

        // 2. Re-fetch entry inside the locked transaction
        const lockedEntry = await tx.waitlistEntry.findUnique({
          where: { id },
          include: { resource: true },
        });

        if (!lockedEntry || lockedEntry.status !== WaitlistStatus.OFFERED) {
          throw new ApiError(
            409,
            `Offer status changed concurrently. Current status: ${lockedEntry?.status || 'NOT_FOUND'}`
          );
        }

        if (lockedEntry.offerExpiresAt && lockedEntry.offerExpiresAt < new Date()) {
          await tx.waitlistEntry.update({
            where: { id },
            data: { status: WaitlistStatus.EXPIRED },
          });
          throw new ApiError(409, 'This waitlist offer has expired.');
        }

        // 3. Double-check for overlapping bookings
        const conflictingBooking = await tx.booking.findFirst({
          where: {
            resourceId: lockedEntry.resourceId,
            status: {
              in: [
                BookingStatus.PENDING,
                BookingStatus.APPROVED,
                BookingStatus.CONFIRMED,
                BookingStatus.CHECKED_IN,
              ],
            },
            AND: [
              { startTime: { lt: lockedEntry.endTime } },
              { endTime: { gt: lockedEntry.startTime } },
            ],
          },
        });

        if (conflictingBooking) {
          throw new ApiError(409, 'Slot conflict: The slot has already been booked by another user.');
        }

        // 4. Delegate to BookingService.createBooking using the transaction client
        const created = await BookingService.createBooking({
          user,
          input: {
            resourceId: lockedEntry.resourceId,
            startTime: lockedEntry.startTime.toISOString(),
            endTime: lockedEntry.endTime.toISOString(),
            purpose: 'Waitlist Offer Accepted',
            activityType: ActivityType.PROJECT_WORK,
            expectedAttendance: 1,
            priority: PriorityLevel.NORMAL,
          },
          tx,
          waitlistEntryId: lockedEntry.id,
        });

        // 5. Record Audit Log
        await tx.auditLog.create({
          data: {
            action: 'WAITLIST_FULFILLED',
            userId: user.id,
            entityType: 'WaitlistEntry',
            entityId: lockedEntry.id,
            details: JSON.stringify({
              bookingId: created.booking.id,
              bookingNumber: created.booking.bookingNumber,
              resourceId: lockedEntry.resourceId,
              startTime: lockedEntry.startTime,
              endTime: lockedEntry.endTime,
            }),
          },
        });

        // 6. Notify user
        await tx.notification.create({
          data: {
            userId: user.id,
            title: `Waitlist Offer Accepted: ${lockedEntry.resource.name}`,
            message: `Your waitlist offer was successfully accepted! Booking #${created.booking.bookingNumber} is confirmed.`,
            type: 'BOOKING',
            link: '/my-bookings?tab=UPCOMING',
          },
        });

        return {
          booking: created.booking,
          waitlistEntry: lockedEntry,
        };
      },
      {
        maxWait: 15000,
        timeout: 30000,
      }
    );

    const updatedEntry = await prisma.waitlistEntry.findUnique({
      where: { id },
      include: { resource: true },
    });

    const entryDto = await mapWaitlistEntryToDTO(updatedEntry);

    return {
      booking: bookingResult.booking,
      waitlistEntry: entryDto,
      message: 'Offer accepted successfully! Your booking is confirmed.',
    };
  }

  /**
   * Background scheduled job that detects expired offers, transitions them to EXPIRED,
   * records audit logs, and automatically promotes the next eligible waiting user.
   */
  static async processOfferExpiry(): Promise<WaitlistExpiryJobResponse> {
    const now = new Date();

    // Query all OFFERED entries whose offerExpiresAt <= now
    const expiredOffers = await prisma.waitlistEntry.findMany({
      where: {
        status: WaitlistStatus.OFFERED,
        offerExpiresAt: { lte: now },
      },
      include: { resource: true },
    });

    let expiredCount = 0;
    let promotedCount = 0;
    const errors: { id: string; error: string }[] = [];

    for (const entry of expiredOffers) {
      const lockKey = getWaitlistLockString(entry.resourceId, entry.startTime, entry.endTime);

      try {
        const result = await prisma.$transaction(
          async (tx) => {
            // Advisory lock
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})::bigint)`;

            // Recheck status inside transaction
            const current = await tx.waitlistEntry.findUnique({
              where: { id: entry.id },
              include: { resource: true },
            });

            if (!current || current.status !== WaitlistStatus.OFFERED) {
              return null; // Already processed
            }

            // Mark EXPIRED
            const updated = await tx.waitlistEntry.update({
              where: { id: entry.id },
              data: {
                status: WaitlistStatus.EXPIRED,
              },
            });

            // Audit log
            await tx.auditLog.create({
              data: {
                action: 'WAITLIST_EXPIRED',
                userId: entry.userId,
                entityType: 'WaitlistEntry',
                entityId: entry.id,
                details: JSON.stringify({
                  resourceId: entry.resourceId,
                  resourceName: entry.resource.name,
                  startTime: entry.startTime,
                  endTime: entry.endTime,
                  offerExpiresAt: entry.offerExpiresAt,
                }),
              },
            });

            // Notify user of expiry
            await tx.notification.create({
              data: {
                userId: entry.userId,
                title: `Offer Expired: ${entry.resource.name}`,
                message: `Your waitlist offer for ${entry.resource.name} on ${formatKolkataDateTime(entry.startTime)} has expired as it was not accepted within 15 minutes.`,
                type: 'BOOKING',
                link: '/my-bookings?tab=WAITLIST',
              },
            });

            return updated;
          },
          { maxWait: 15000, timeout: 30000 }
        );

        if (result) {
          expiredCount++;
          // Promote next user for this slot
          const nextOffer = await WaitlistService.triggerSlotOffer({
            resourceId: entry.resourceId,
            startTime: entry.startTime,
            endTime: entry.endTime,
          });
          if (nextOffer) {
            promotedCount++;
          }
        }
      } catch (err: any) {
        errors.push({ id: entry.id, error: err.message || String(err) });
      }
    }

    return {
      processed: expiredOffers.length,
      expired: expiredCount,
      promoted: promotedCount,
      errors: errors.length > 0 ? errors : undefined,
      message: `Processed ${expiredOffers.length} expired offers. Marked ${expiredCount} as EXPIRED, promoted ${promotedCount} new users.`,
    };
  }
}
