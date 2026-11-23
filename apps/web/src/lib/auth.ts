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
  avatarUrl?: string | null;
}

export interface TokenPayload {
  id: string;
  email: string;
  role: Role;
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
  } catch (err) {
    throw new ApiError(401, 'Invalid or expired session. Please log in again.');
  }
}

function extractTokenFromRequest(request?: Request): string | null {
  // 1. Try reading from httpOnly cookie
  try {
    const cookieStore = cookies();
    const cookieToken = cookieStore.get('token')?.value || cookieStore.get('lpu_session')?.value;
    if (cookieToken) return cookieToken;
  } catch {
    // cookies() might fail if outside next/headers context
  }

  if (request) {
    // 2. Check Cookie header directly on the Request
    const rawCookie = request.headers.get('cookie');
    if (rawCookie) {
      const match = rawCookie.match(/(?:^|;\s*)(?:token|lpu_session)=([^;]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]);
      }
    }

    // 3. Fall back to Authorization Bearer header
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
        avatarUrl: true,
      },
    });

    return user as AuthenticatedUser | null;
  } catch {
    return null;
  }
}

export async function requireAuth(request?: Request): Promise<AuthenticatedUser> {
  const user = await getSessionUser(request);
  if (!user) {
    throw new ApiError(401, 'Access token required. Please sign in.');
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
