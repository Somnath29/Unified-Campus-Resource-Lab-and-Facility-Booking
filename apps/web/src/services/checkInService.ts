import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth';
import { BookingStatus, CheckInMethod, Prisma, Role } from '@prisma/client';
import {
  decryptResourceSecret,
  encryptResourceSecret,
  generateResourceSecret,
  signCheckInToken,
  verifyPinHash,
  verifySignedCheckInToken,
  verifyVenueQrPayload,
} from '@/lib/checkin-crypto';
import { enforceRateLimit } from '@/lib/rate-limit';
import { formatKolkataTime } from '@/lib/timezone';
import {
  CheckInErrorCode,
  CheckInRequest,
  CheckInSuccessResponse,
  CheckInTokenResponse,
  ResourceRoomQrDTO,
  RotateResourceQrResponse,
} from '@lpu/shared';

export interface CheckInActor {
  id: string;
  email: string;
  role: Role;
  name?: string;
  department: string;
}

const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 10 * 60 * 1000; // 10 minutes
const EARLY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes before startTime

function throwCheckInError(
  status: number,
  code: CheckInErrorCode,
  message: string,
  extra?: Record<string, any>
): never {
  throw new ApiError(status, message, { code, ...extra });
}

function isAuthorizedStaffForDepartment(actor: CheckInActor, resourceDepartment: string): boolean {
  if (actor.role === Role.ADMINISTRATOR) return true;
  if (actor.role === Role.DEPARTMENT_APPROVER && actor.department === resourceDepartment) return true;
  return false;
}

function sanitizeBookingResponse(booking: any) {
  if (!booking) return booking;
  const copy = { ...booking };
  delete copy.checkInPinHash;
  if (copy.resource) {
    const resCopy = { ...copy.resource };
    delete resCopy.checkInSecretEncrypted;
    copy.resource = resCopy;
  }
  return copy;
}

export class CheckInService {
  /**
   * Ensures a resource has an encrypted venue secret stored at rest.
   */
  static async ensureResourceSecret(
    resourceId: string,
    tx: Prisma.TransactionClient | typeof prisma = prisma
  ): Promise<{ encrypted: string; version: number; rotatedAt: Date | null }> {
    const resource = await tx.resource.findUnique({
      where: { id: resourceId },
      select: {
        id: true,
        checkInSecretEncrypted: true,
        checkInSecretVersion: true,
        checkInSecretRotatedAt: true,
      },
    });

    if (!resource) {
      throw new ApiError(404, 'Resource not found.');
    }

    if (resource.checkInSecretEncrypted) {
      return {
        encrypted: resource.checkInSecretEncrypted,
        version: resource.checkInSecretVersion,
        rotatedAt: resource.checkInSecretRotatedAt,
      };
    }

    const secret = generateResourceSecret();
    const encrypted = encryptResourceSecret(secret);
    const now = new Date();
    const updated = await tx.resource.update({
      where: { id: resourceId },
      data: {
        checkInSecretEncrypted: encrypted,
        checkInSecretVersion: 1,
        checkInSecretRotatedAt: now,
      },
      select: {
        checkInSecretEncrypted: true,
        checkInSecretVersion: true,
        checkInSecretRotatedAt: true,
      },
    });

    return {
      encrypted: updated.checkInSecretEncrypted!,
      version: updated.checkInSecretVersion,
      rotatedAt: updated.checkInSecretRotatedAt,
    };
  }

  /**
   * Retrieves the printable room QR payload for authorized staff (Admin or in-scope Approver).
   */
  static async getResourceRoomQr(params: {
    resourceId: string;
    actor: CheckInActor;
  }): Promise<ResourceRoomQrDTO> {
    const resource = await prisma.resource.findUnique({
      where: { id: params.resourceId },
      select: {
        id: true,
        code: true,
        name: true,
        building: true,
        floor: true,
        department: true,
        deletedAt: true,
        checkInSecretEncrypted: true,
        checkInSecretVersion: true,
        checkInSecretRotatedAt: true,
      },
    });

    if (!resource || resource.deletedAt !== null) {
      throw new ApiError(404, 'Resource not found.');
    }

    if (!isAuthorizedStaffForDepartment(params.actor, resource.department)) {
      throwCheckInError(
        403,
        'WRONG_USER',
        'Forbidden: Only administrators or authorized department approvers may access room venue QR codes.'
      );
    }

    const secretState = await CheckInService.ensureResourceSecret(resource.id);
    const plaintextSecret = decryptResourceSecret(secretState.encrypted);

    const qrPayload = JSON.stringify({
      type: 'LPU_VENUE_QR',
      resourceId: resource.id,
      secret: plaintextSecret,
      version: secretState.version,
    });

    return {
      resourceId: resource.id,
      resourceCode: resource.code,
      resourceName: resource.name,
      building: resource.building,
      floor: resource.floor,
      department: resource.department,
      secretVersion: secretState.version,
      rotatedAt: secretState.rotatedAt ? secretState.rotatedAt.toISOString() : null,
      qrPayload,
    };
  }

  /**
   * Rotates a resource's venue secret, immediately invalidating all previously printed room QRs.
   */
  static async rotateResourceRoomQr(params: {
    resourceId: string;
    actor: CheckInActor;
  }): Promise<RotateResourceQrResponse> {
    const resource = await prisma.resource.findUnique({
      where: { id: params.resourceId },
      select: {
        id: true,
        code: true,
        name: true,
        building: true,
        floor: true,
        department: true,
        deletedAt: true,
        checkInSecretVersion: true,
      },
    });

    if (!resource || resource.deletedAt !== null) {
      throw new ApiError(404, 'Resource not found.');
    }

    if (!isAuthorizedStaffForDepartment(params.actor, resource.department)) {
      throwCheckInError(
        403,
        'WRONG_USER',
        'Forbidden: Only administrators or authorized department approvers may rotate room QR secrets.'
      );
    }

    const newSecret = generateResourceSecret();
    const encrypted = encryptResourceSecret(newSecret);
    const now = new Date();
    const nextVersion = (resource.checkInSecretVersion || 1) + 1;

    await prisma.$transaction(async (tx) => {
      await tx.resource.update({
        where: { id: resource.id },
        data: {
          checkInSecretEncrypted: encrypted,
          checkInSecretVersion: nextVersion,
          checkInSecretRotatedAt: now,
        },
      });

      await tx.auditLog.create({
        data: {
          action: 'RESOURCE_QR_ROTATED',
          userId: params.actor.id,
          entityType: 'Resource',
          entityId: resource.id,
          details: JSON.stringify({
            resourceCode: resource.code,
            resourceName: resource.name,
            newVersion: nextVersion,
            rotatedBy: params.actor.email,
          }),
        },
      });
    });

    const qrPayload = JSON.stringify({
      type: 'LPU_VENUE_QR',
      resourceId: resource.id,
      secret: newSecret,
      version: nextVersion,
    });

    return {
      roomQr: {
        resourceId: resource.id,
        resourceCode: resource.code,
        resourceName: resource.name,
        building: resource.building,
        floor: resource.floor,
        department: resource.department,
        secretVersion: nextVersion,
        rotatedAt: now.toISOString(),
        qrPayload,
      },
      message: `Room QR secret rotated to version ${nextVersion}. Previously printed QR codes are now invalid.`,
    };
  }

  /**
   * Generates (or regenerates) a 5-minute signed QR check-in token on demand.
   * Regenerating invalidates any previously issued token for this booking.
   */
  static async generateBookingCheckInToken(params: {
    bookingId: string;
    actor: CheckInActor;
  }): Promise<CheckInTokenResponse> {
    const booking = await prisma.booking.findUnique({
      where: { id: params.bookingId },
      include: { resource: true },
    });

    if (!booking) {
      throw new ApiError(404, 'Booking not found.');
    }

    const isOwner = booking.userId === params.actor.id;
    const isStaff = isAuthorizedStaffForDepartment(params.actor, booking.resource.department);

    if (!isOwner && !isStaff) {
      throwCheckInError(403, 'WRONG_USER', 'You are not authorized to generate a check-in pass for this booking.');
    }

    if (booking.status === BookingStatus.PENDING) {
      throwCheckInError(409, 'PENDING_BOOKING', 'Pending bookings cannot be checked in until approved.');
    }
    if (booking.status === BookingStatus.CHECKED_IN) {
      throwCheckInError(409, 'BOOKING_ALREADY_CHECKED_IN', 'This booking is already checked in.');
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throwCheckInError(409, 'BOOKING_NOT_CONFIRMED', `Cannot generate check-in token for booking with status ${booking.status}.`);
    }

    const now = new Date();
    const earliestCheckIn = new Date(booking.startTime.getTime() - EARLY_WINDOW_MS);
    const releaseDeadline = booking.releaseDeadline || new Date(booking.startTime.getTime() + 15 * 60000);

    if (now > booking.endTime) {
      throwCheckInError(409, 'BOOKING_ALREADY_ENDED', 'Cannot generate check-in token after the booking has ended.');
    }

    if (now < earliestCheckIn) {
      throwCheckInError(
        400,
        'CHECK_IN_TOO_EARLY',
        `Check-in opens 30 minutes before start time (at ${formatKolkataTime(earliestCheckIn)} IST).`,
        { availableFrom: earliestCheckIn.toISOString() }
      );
    }

    if (now > releaseDeadline && !isStaff) {
      throwCheckInError(
        409,
        'CHECK_IN_TOO_LATE',
        `The check-in release deadline (${formatKolkataTime(releaseDeadline)} IST) has passed. Please contact an approver or administrator for a late check-in override.`,
        { releaseDeadline: releaseDeadline.toISOString(), canOverride: false }
      );
    }

    const signed = signCheckInToken({
      bookingId: booking.id,
      userId: booking.userId,
      resourceId: booking.resourceId,
    });

    await prisma.booking.update({
      where: { id: booking.id },
      data: {
        activeCheckInTokenJti: signed.jti,
      },
    });

    const qrPayload = JSON.stringify({
      type: 'LPU_BOOKING_QR',
      bookingId: booking.id,
      token: signed.token,
    });

    return {
      token: signed.token,
      expiresAt: signed.expiresAt.toISOString(),
      expiresInSeconds: signed.expiresInSeconds,
      bookingId: booking.id,
      resourceId: booking.resourceId,
      qrPayload,
    };
  }

  /**
   * Verifies check-in credentials (signed QR token or 6-digit PIN + venue QR, or authorized override)
   * and atomically transitions the booking to CHECKED_IN.
   */
  static async verifyAndCheckIn(params: {
    bookingId: string;
    actor: CheckInActor;
    input: CheckInRequest;
    clientIp: string;
  }): Promise<CheckInSuccessResponse> {
    const { bookingId, actor, input, clientIp } = params;

    // 1. Distributed database-backed rate limiting (IP, User, Booking)
    await enforceRateLimit({
      key: `checkin:ip:${clientIp}`,
      maxRequests: 30,
      windowSeconds: 60,
      label: 'check-in requests from this IP',
    });
    await enforceRateLimit({
      key: `checkin:user:${actor.id}`,
      maxRequests: 20,
      windowSeconds: 60,
      label: 'check-in requests',
    });
    await enforceRateLimit({
      key: `checkin:booking:${bookingId}`,
      maxRequests: 20,
      windowSeconds: 60,
      label: 'check-in attempts for this booking',
    });

    const hasBookingToken = Boolean(input.bookingToken && input.bookingToken.trim());
    const hasPin = Boolean(input.pin && input.pin.trim());
    const hasOverride = Boolean(input.override);

    if (!hasBookingToken && !hasPin && !hasOverride) {
      throwCheckInError(
        400,
        'INVALID_BOOKING_TOKEN',
        'Provide a signed booking QR token, 6-digit fallback PIN, or authorized override.'
      );
    }

    // Pre-verify token signature/expiry before entering lock if token was provided
    // (Note: invalid/expired QR token MUST NOT consume a PIN attempt)
    let parsedTokenPayload: { sub: string; bookingId: string; resourceId: string; jti: string; exp: number } | null = null;
    if (hasBookingToken) {
      const tokenCheck = verifySignedCheckInToken(input.bookingToken!);
      if (!tokenCheck.valid) {
        throwCheckInError(401, tokenCheck.code, tokenCheck.message);
      }
      parsedTokenPayload = tokenCheck.payload;
    }

    type TxOutcome =
      | { ok: true; booking: any; checkInMethod: CheckInMethod; checkedInAt: Date; venueVerified: boolean }
      | {
          ok: false;
          status: number;
          code: CheckInErrorCode;
          message: string;
          extra?: Record<string, any>;
        };

    const outcome: TxOutcome = await prisma.$transaction(async (tx) => {
      // Lock the booking row to prevent concurrent check-ins or conflicting transitions
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM "Booking" WHERE id = ${bookingId} FOR UPDATE
      `;
      if (!locked || locked.length === 0) {
        return {
          ok: false,
          status: 404,
          code: 'BOOKING_NOT_CONFIRMED',
          message: 'Booking not found.',
        };
      }

      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { resource: true, user: true },
      });

      if (!booking) {
        return {
          ok: false,
          status: 404,
          code: 'BOOKING_NOT_CONFIRMED',
          message: 'Booking not found.',
        };
      }

      // 2. Authorization check
      const isOwner = booking.userId === actor.id;
      const isStaff = isAuthorizedStaffForDepartment(actor, booking.resource.department);

      if (!isOwner && !isStaff) {
        return {
          ok: false,
          status: 403,
          code: 'WRONG_USER',
          message: 'Forbidden: You are not authorized to check in this booking.',
        };
      }

      // Validate override permissions & reason upfront
      const overrideReason = input.override?.reason?.trim() || '';
      if (hasOverride) {
        if (!isStaff) {
          return {
            ok: false,
            status: 403,
            code: 'WRONG_USER',
            message: 'Forbidden: Only authorized approvers or administrators may perform a check-in override.',
          };
        }
        if (overrideReason.length < 3) {
          return {
            ok: false,
            status: 400,
            code: 'OVERRIDE_REASON_REQUIRED',
            message: 'A clear reason (minimum 3 characters) is required for an override check-in.',
          };
        }
      }

      // 3. Booking status validation (revalidated inside transaction)
      if (booking.status === BookingStatus.PENDING) {
        return {
          ok: false,
          status: 409,
          code: 'PENDING_BOOKING',
          message: 'Pending bookings cannot be checked in until approved and confirmed.',
        };
      }

      if (booking.status === BookingStatus.CHECKED_IN) {
        return {
          ok: false,
          status: 409,
          code: 'BOOKING_ALREADY_CHECKED_IN',
          message: 'This booking is already checked in.',
        };
      }

      if (booking.status !== BookingStatus.CONFIRMED) {
        return {
          ok: false,
          status: 409,
          code: 'BOOKING_NOT_CONFIRMED',
          message: `Cannot check in a booking with status ${booking.status}.`,
        };
      }

      // 4. Time window validation (server time)
      const now = new Date();
      const earliestCheckIn = new Date(booking.startTime.getTime() - EARLY_WINDOW_MS);
      const releaseDeadline =
        booking.releaseDeadline || new Date(booking.startTime.getTime() + 15 * 60000);

      if (now > booking.endTime) {
        return {
          ok: false,
          status: 409,
          code: 'BOOKING_ALREADY_ENDED',
          message: 'Check-in rejected: the scheduled booking end time has already passed.',
        };
      }

      if (now < earliestCheckIn) {
        return {
          ok: false,
          status: 400,
          code: 'CHECK_IN_TOO_EARLY',
          message: `Check-in is too early. Window opens 30 minutes before start (${formatKolkataTime(earliestCheckIn)} IST).`,
          extra: { availableFrom: earliestCheckIn.toISOString() },
        };
      }

      const isLate = now > releaseDeadline;
      const overriddenRules: string[] = [];

      if (isLate) {
        if (hasOverride && input.override?.bypassLateWindow !== false && isStaff) {
          overriddenRules.push('LATE_RELEASE_DEADLINE');
        } else {
          return {
            ok: false,
            status: 409,
            code: 'CHECK_IN_TOO_LATE',
            message: `Check-in release deadline (${formatKolkataTime(releaseDeadline)} IST) has passed. An authorized approver or administrator override with reason is required.`,
            extra: {
              releaseDeadline: releaseDeadline.toISOString(),
              canOverride: isStaff,
            },
          };
        }
      }

      // 5. Venue verification (required unless explicitly overridden by authorized staff)
      let venueVerified = false;
      const bypassVenue = Boolean(hasOverride && input.override?.bypassVenueVerification && isStaff);

      if (bypassVenue) {
        overriddenRules.push('VENUE_QR_VERIFICATION');
      } else {
        if (!input.venueQr || !input.venueQr.trim()) {
          return {
            ok: false,
            status: 400,
            code: 'INVALID_VENUE_QR',
            message: 'Room venue QR verification is required. Please scan the QR code posted in the room.',
          };
        }

        const secretState = await CheckInService.ensureResourceSecret(booking.resourceId, tx);
        const venueResult = verifyVenueQrPayload(
          input.venueQr,
          booking.resourceId,
          secretState.encrypted
        );

        if (!venueResult.valid) {
          return {
            ok: false,
            status: venueResult.reason === 'VENUE_MISMATCH' ? 403 : 400,
            code: venueResult.reason || 'INVALID_VENUE_QR',
            message:
              venueResult.reason === 'VENUE_MISMATCH'
                ? 'Venue mismatch: You scanned the QR code for a different room than your booking.'
                : 'Invalid or outdated room venue QR code. Please scan the current room QR.',
          };
        }
        venueVerified = true;
      }

      // 6. Primary Credential Verification (QR Token vs PIN vs Staff Override)
      let checkInMethod: CheckInMethod;
      let consumedJti: string | null = null;

      if (parsedTokenPayload) {
        // Bind token to booking, owner, and resource
        if (
          parsedTokenPayload.bookingId !== booking.id ||
          parsedTokenPayload.sub !== booking.userId ||
          parsedTokenPayload.resourceId !== booking.resourceId
        ) {
          return {
            ok: false,
            status: 403,
            code: 'INVALID_BOOKING_TOKEN',
            message: 'Check-in token does not match this booking, owner, or resource.',
          };
        }

        // Reject if token was superseded by regeneration
        if (booking.activeCheckInTokenJti && booking.activeCheckInTokenJti !== parsedTokenPayload.jti) {
          return {
            ok: false,
            status: 409,
            code: 'REPLAYED_BOOKING_TOKEN',
            message: 'This QR token has been superseded by a newer token. Please use the latest QR pass.',
          };
        }

        // Atomic replay protection via ConsumedCheckInToken
        try {
          await tx.consumedCheckInToken.create({
            data: {
              jti: parsedTokenPayload.jti,
              bookingId: booking.id,
              userId: booking.userId,
              resourceId: booking.resourceId,
              expiresAt: new Date(parsedTokenPayload.exp * 1000),
            },
          });
        } catch (err: any) {
          if (err?.code === 'P2002') {
            return {
              ok: false,
              status: 409,
              code: 'REPLAYED_BOOKING_TOKEN',
              message: 'This QR check-in token has already been used and cannot be replayed.',
            };
          }
          throw err;
        }

        consumedJti = parsedTokenPayload.jti;
        checkInMethod = CheckInMethod.QR_TOKEN;
      } else if (hasPin) {
        // Check persistent PIN lockout
        if (booking.pinLockedUntil && booking.pinLockedUntil > now) {
          const retryAfterSeconds = Math.max(
            1,
            Math.ceil((booking.pinLockedUntil.getTime() - now.getTime()) / 1000)
          );
          return {
            ok: false,
            status: 429,
            code: 'PIN_LOCKED',
            message: `PIN verification is locked due to ${MAX_PIN_ATTEMPTS} failed attempts. Try again in ${Math.ceil(retryAfterSeconds / 60)} minute(s).`,
            extra: {
              lockedUntil: booking.pinLockedUntil.toISOString(),
              retryAfterSeconds,
              remainingAttempts: 0,
            },
          };
        }

        const pinTrimmed = input.pin!.trim();
        const isPinValid =
          /^\d{6}$/.test(pinTrimmed) && verifyPinHash(pinTrimmed, booking.checkInPinHash);

        if (!isPinValid) {
          // Reset counter if previous lockout expired, then increment
          const baseAttempts =
            booking.pinLockedUntil && booking.pinLockedUntil <= now ? 0 : booking.pinFailedAttempts;
          const nextAttempts = baseAttempts + 1;
          const shouldLock = nextAttempts >= MAX_PIN_ATTEMPTS;
          const nextLockedUntil = shouldLock ? new Date(now.getTime() + PIN_LOCKOUT_MS) : null;

          // Persist inside transaction & return { ok: false } so transaction COMMITS the counter!
          await tx.booking.update({
            where: { id: booking.id },
            data: {
              pinFailedAttempts: nextAttempts,
              pinLockedUntil: nextLockedUntil,
            },
          });

          if (shouldLock && nextLockedUntil) {
            const retryAfterSeconds = Math.ceil(PIN_LOCKOUT_MS / 1000);
            return {
              ok: false,
              status: 429,
              code: 'PIN_LOCKED',
              message: `Maximum PIN attempts (${MAX_PIN_ATTEMPTS}) exceeded. PIN verification is locked for 10 minutes.`,
              extra: {
                lockedUntil: nextLockedUntil.toISOString(),
                retryAfterSeconds,
                remainingAttempts: 0,
              },
            };
          }

          const remainingAttempts = MAX_PIN_ATTEMPTS - nextAttempts;
          return {
            ok: false,
            status: 401,
            code: 'INVALID_PIN',
            message: `Invalid 6-digit PIN. ${remainingAttempts} attempt(s) remaining before 10-minute lockout.`,
            extra: { remainingAttempts },
          };
        }

        checkInMethod = hasOverride
          ? actor.role === Role.ADMINISTRATOR
            ? CheckInMethod.ADMIN_OVERRIDE
            : CheckInMethod.APPROVER_OVERRIDE
          : CheckInMethod.PIN;
      } else {
        // Pure staff override (e.g., late check-in and/or venue override)
        checkInMethod =
          actor.role === Role.ADMINISTRATOR
            ? CheckInMethod.ADMIN_OVERRIDE
            : CheckInMethod.APPROVER_OVERRIDE;
      }

      if (overriddenRules.length > 0 && hasOverride) {
        checkInMethod =
          actor.role === Role.ADMINISTRATOR
            ? CheckInMethod.ADMIN_OVERRIDE
            : CheckInMethod.APPROVER_OVERRIDE;
      }

      // 7. Atomically transition booking to CHECKED_IN
      const updatedBooking = await tx.booking.update({
        where: { id: booking.id },
        data: {
          status: BookingStatus.CHECKED_IN,
          checkedInAt: now,
          checkInMethod,
          checkedInById: actor.id,
          checkInOverrideReason: hasOverride ? overrideReason : null,
          venueVerified,
          checkInTokenJti: consumedJti,
          activeCheckInTokenJti: null,
          pinFailedAttempts: 0,
          pinLockedUntil: null,
        },
        include: { resource: true, user: true },
      });

      // 8. Durable AuditLog & Notification
      await tx.auditLog.create({
        data: {
          action: hasOverride ? 'CHECKIN_OVERRIDE_COMPLETED' : 'CHECKIN_COMPLETED',
          userId: actor.id,
          entityType: 'Booking',
          entityId: booking.id,
          details: JSON.stringify({
            bookingNumber: booking.bookingNumber,
            resourceId: booking.resourceId,
            resourceName: booking.resource.name,
            bookingOwnerId: booking.userId,
            checkedInById: actor.id,
            checkedInByRole: actor.role,
            onBehalfOfOwner: !isOwner,
            checkInMethod,
            venueVerified,
            overriddenRules,
            overrideReason: hasOverride ? overrideReason : null,
            tokenJti: consumedJti,
            checkedInAt: now.toISOString(),
          }),
        },
      });

      await tx.notification.create({
        data: {
          userId: booking.userId,
          title: `Check-in Verified: ${booking.resource.name}`,
          message: isOwner
            ? `Your check-in for ${booking.resource.name} is confirmed at ${formatKolkataTime(now)} IST.`
            : `Your check-in for ${booking.resource.name} was completed by staff (${actor.name || actor.role}) at ${formatKolkataTime(now)} IST.`,
          type: 'CHECKIN',
          link: '/my-bookings',
        },
      });

      return {
        ok: true,
        booking: updatedBooking,
        checkInMethod,
        checkedInAt: now,
        venueVerified,
      };
    });

    if (!outcome.ok) {
      throwCheckInError(outcome.status, outcome.code, outcome.message, outcome.extra);
    }

    return {
      success: true,
      message: `Check-in successful! ${outcome.booking.resource.name} is now active for your session.`,
      checkedInAt: outcome.checkedInAt.toISOString(),
      checkInMethod: outcome.checkInMethod,
      checkedInById: actor.id,
      venueVerified: outcome.venueVerified,
      overrideReason: hasOverride ? input.override?.reason?.trim() || null : null,
      booking: sanitizeBookingResponse(outcome.booking),
    };
  }
}
