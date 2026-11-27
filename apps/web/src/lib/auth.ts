import jwt from 'jsonwebtoken';
import { cookies } from 'next/headers';
import { prisma } from './prisma';
import { env } from './env';
import { Role } from '@prisma/client';

export class ApiError extends Error {
  status: number;
  details?: any;

  constructor(status: number, message: string, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  name: string;
  department: string;
  regNo?: string | null;
  designation?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  passwordChangedAt?: Date | null;
  tokenVersion?: number;
  sessionId?: string;
}

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
  sid?: string;
  tv?: number;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch {
    throw new ApiError(401, 'Invalid or expired session. Please log in again.');
  }
}

export function parseDeviceLabel(userAgent: string | null | undefined): string {
  if (!userAgent || !userAgent.trim()) return 'Unknown device';
  const ua = userAgent;
  let browser = 'Browser';
  if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('Chrome/') && !ua.includes('Chromium')) browser = 'Chrome';
  else if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Safari/') && !ua.includes('Chrome/')) browser = 'Safari';
  else if (ua.includes('curl/')) browser = 'CLI / curl';

  let os = '';
  if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Linux')) os = 'Linux';

  return os ? `${browser} on ${os}` : browser;
}

export function extractRequestMetadata(request?: Request): {
  userAgent: string | null;
  ipAddress: string | null;
  deviceLabel: string;
} {
  if (!request) {
    return { userAgent: null, ipAddress: null, deviceLabel: 'Unknown device' };
  }
  const userAgent = request.headers.get('user-agent') || null;
  const forwarded = request.headers.get('x-forwarded-for');
  const ipAddress =
    (forwarded ? forwarded.split(',')[0]?.trim() : null) ||
    request.headers.get('x-real-ip')?.trim() ||
    null;

  return {
    userAgent,
    ipAddress,
    deviceLabel: parseDeviceLabel(userAgent),
  };
}

/**
 * Creates a persistent revocable UserSession in PostgreSQL and returns a signed JWT.
 */
export async function createSessionAndToken(params: {
  user: { id: string; email: string; role: Role; tokenVersion: number };
  request?: Request;
}): Promise<{ token: string; sessionId: string }> {
  const meta = extractRequestMetadata(params.request);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const session = await prisma.userSession.create({
    data: {
      userId: params.user.id,
      userAgent: meta.userAgent,
      deviceLabel: meta.deviceLabel,
      ipAddress: meta.ipAddress,
      expiresAt,
    },
  });

  const token = signToken({
    id: params.user.id,
    email: params.user.email,
    role: params.user.role,
    sid: session.id,
    tv: params.user.tokenVersion,
  });

  return { token, sessionId: session.id };
}

function extractTokenFromRequest(request?: Request): string | null {
  try {
    const cookieStore = cookies();
    const cookieToken = cookieStore.get('token')?.value || cookieStore.get('lpu_session')?.value;
    if (cookieToken) return cookieToken;
  } catch {
    // cookies() might fail outside next/headers context
  }

  if (request) {
    const rawCookie = request.headers.get('cookie');
    if (rawCookie) {
      const match = rawCookie.match(/(?:^|;\s*)(?:token|lpu_session)=([^;]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }

    const authHeader = request.headers.get('authorization');
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
  }

  return null;
}

export async function getSessionUser(request?: Request): Promise<AuthenticatedUser | null> {
  const token = extractTokenFromRequest(request);
  if (!token) {
    return null;
  }

  try {
    const decoded = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        department: true,
        regNo: true,
        designation: true,
        phone: true,
        avatarUrl: true,
        passwordChangedAt: true,
        tokenVersion: true,
      },
    });

    if (!user) return null;

    // Reject if tokenVersion was incremented (global sign-out or password change)
    if (decoded.tv !== undefined && decoded.tv !== user.tokenVersion) {
      return null;
    }

    // Reject if persistent session was revoked or expired
    if (decoded.sid) {
      const session = await prisma.userSession.findUnique({
        where: { id: decoded.sid },
        select: { id: true, userId: true, revokedAt: true, expiresAt: true, lastActiveAt: true },
      });
      if (!session || session.userId !== user.id || session.revokedAt !== null || session.expiresAt <= new Date()) {
        return null;
      }

      // Throttled lastActiveAt update (at most once per 60s)
      if (Date.now() - session.lastActiveAt.getTime() > 60_000) {
        prisma.userSession
          .update({ where: { id: session.id }, data: { lastActiveAt: new Date() } })
          .catch(() => {});
      }
    }

    return {
      ...user,
      sessionId: decoded.sid,
    } as AuthenticatedUser;
  } catch {
    return null;
  }
}

export async function requireAuth(request?: Request): Promise<AuthenticatedUser> {
  const user = await getSessionUser(request);
  if (!user) {
    throw new ApiError(401, 'Access token required or session has been revoked. Please sign in.');
  }
  return user;
}

export async function requireRole(
  request: Request | undefined,
  ...roles: Role[]
): Promise<AuthenticatedUser> {
  const user = await requireAuth(request);
  if (!roles.includes(user.role)) {
    throw new ApiError(
      403,
      `Permission denied. Required role: ${roles.join(' or ')}. Your role: ${user.role}`
    );
  }
  return user;
}
