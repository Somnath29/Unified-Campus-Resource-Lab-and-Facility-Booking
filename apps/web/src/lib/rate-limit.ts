import { prisma } from '@/lib/prisma';
import { ApiError } from '@/lib/auth';

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Distributed, PostgreSQL-backed rate limiter using atomic UPSERT on RateLimitBucket.
 * Safe across multiple serverless/container instances.
 */
export async function checkRateLimit(params: {
  key: string;
  maxRequests: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const { key, maxRequests, windowSeconds } = params;

  const rows = await prisma.$queryRaw<Array<{ count: number; expiresAt: Date }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "windowStart", "expiresAt")
    VALUES (${key}, 1, NOW(), NOW() + (${windowSeconds} * INTERVAL '1 second'))
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN 1
        ELSE "RateLimitBucket"."count" + 1
      END,
      "windowStart" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN NOW()
        ELSE "RateLimitBucket"."windowStart"
      END,
      "expiresAt" = CASE
        WHEN "RateLimitBucket"."expiresAt" <= NOW() THEN NOW() + (${windowSeconds} * INTERVAL '1 second')
        ELSE "RateLimitBucket"."expiresAt"
      END
    RETURNING "count", "expiresAt"
  `;

  const row = rows[0];
  const count = Number(row?.count ?? 1);
  const expiresAt = row?.expiresAt ? new Date(row.expiresAt) : new Date(Date.now() + windowSeconds * 1000);
  const retryAfterSeconds = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));

  return {
    allowed: count <= maxRequests,
    count,
    remaining: Math.max(0, maxRequests - count),
    retryAfterSeconds,
  };
}

/**
 * Enforces rate limiting and throws ApiError(429) with structured RATE_LIMITED details if exceeded.
 */
export async function enforceRateLimit(params: {
  key: string;
  maxRequests: number;
  windowSeconds: number;
  label?: string;
}): Promise<void> {
  const res = await checkRateLimit(params);
  if (!res.allowed) {
    throw new ApiError(
      429,
      `Too many ${params.label || 'requests'}. Please try again in ${res.retryAfterSeconds} seconds.`,
      {
        code: 'RATE_LIMITED',
        retryAfterSeconds: res.retryAfterSeconds,
      }
    );
  }
}

/**
 * Extracts best-effort client IP from request headers.
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return 'unknown-ip';
}
