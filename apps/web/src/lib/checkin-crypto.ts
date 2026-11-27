import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import env from '@/config/env';

/**
 * Generates a cryptographically secure 6-digit PIN using Node's crypto.randomInt.
 */
export function generateSecurePin(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Hashes a 6-digit PIN with a per-PIN random 16-byte salt using scrypt.
 */
export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(pin, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verifies a 6-digit PIN against a stored scrypt hash in constant time.
 */
export function verifyPinHash(pin: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;

  const actualBuf = crypto.scryptSync(pin, salt, 32);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;

  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

/**
 * Generates a 256-bit high-entropy secret for a Resource's venue QR.
 */
export function generateResourceSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

function getEncryptionKeyBuffer(): Buffer {
  return Buffer.from(env.RESOURCE_SECRET_ENCRYPTION_KEY, 'hex');
}

/**
 * Encrypts a resource venue secret at rest using AES-256-GCM.
 */
export function encryptResourceSecret(plaintext: string): string {
  const key = getEncryptionKeyBuffer();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Decrypts a resource venue secret stored with AES-256-GCM.
 */
export function decryptResourceSecret(encryptedPayload: string): string {
  const parts = encryptedPayload.split(':');
  if (parts.length !== 3) {
    throw new Error('Malformed encrypted resource secret.');
  }
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = getEncryptionKeyBuffer();
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(cipherHex, 'hex');

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

export interface VenueQrCheckResult {
  valid: boolean;
  reason?: 'INVALID_VENUE_QR' | 'VENUE_MISMATCH';
}

/**
 * Validates a scanned room venue QR payload (or raw secret) against the booking's resource.
 */
export function verifyVenueQrPayload(
  scannedVenueQr: string,
  expectedResourceId: string,
  encryptedSecret: string | null | undefined
): VenueQrCheckResult {
  if (!encryptedSecret || !scannedVenueQr || !scannedVenueQr.trim()) {
    return { valid: false, reason: 'INVALID_VENUE_QR' };
  }

  let expectedSecret: string;
  try {
    expectedSecret = decryptResourceSecret(encryptedSecret);
  } catch {
    return { valid: false, reason: 'INVALID_VENUE_QR' };
  }

  let candidateSecret = scannedVenueQr.trim();
  if (candidateSecret.startsWith('{')) {
    try {
      const parsed = JSON.parse(candidateSecret);
      if (parsed.type && parsed.type !== 'LPU_VENUE_QR') {
        return { valid: false, reason: 'INVALID_VENUE_QR' };
      }
      if (parsed.resourceId && parsed.resourceId !== expectedResourceId) {
        return { valid: false, reason: 'VENUE_MISMATCH' };
      }
      if (typeof parsed.secret !== 'string' || !parsed.secret) {
        return { valid: false, reason: 'INVALID_VENUE_QR' };
      }
      candidateSecret = parsed.secret;
    } catch {
      return { valid: false, reason: 'INVALID_VENUE_QR' };
    }
  }

  const candidateBuf = Buffer.from(candidateSecret, 'utf8');
  const expectedBuf = Buffer.from(expectedSecret, 'utf8');
  if (candidateBuf.length !== expectedBuf.length) {
    return { valid: false, reason: 'INVALID_VENUE_QR' };
  }

  if (!crypto.timingSafeEqual(candidateBuf, expectedBuf)) {
    return { valid: false, reason: 'INVALID_VENUE_QR' };
  }

  return { valid: true };
}

export interface CheckInJwtPayload {
  sub: string;
  bookingId: string;
  resourceId: string;
  jti: string;
  typ: 'checkin_qr';
  iat: number;
  exp: number;
}

/**
 * Issues a short-lived (5-minute) HMAC-SHA256 signed QR check-in token.
 */
export function signCheckInToken(params: {
  bookingId: string;
  userId: string;
  resourceId: string;
}): {
  token: string;
  jti: string;
  expiresAt: Date;
  expiresInSeconds: number;
} {
  const jti = crypto.randomUUID();
  const expiresInSeconds = 300; // Exactly 5 minutes
  const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

  const token = jwt.sign(
    {
      sub: params.userId,
      bookingId: params.bookingId,
      resourceId: params.resourceId,
      jti,
      typ: 'checkin_qr',
    },
    env.CHECKIN_TOKEN_SECRET,
    {
      algorithm: 'HS256',
      expiresIn: expiresInSeconds,
    }
  );

  return { token, jti, expiresAt, expiresInSeconds };
}

/**
 * Verifies a signed QR check-in token (either raw JWT or JSON QR payload).
 */
export function verifySignedCheckInToken(rawInput: string):
  | { valid: true; payload: CheckInJwtPayload }
  | { valid: false; code: 'INVALID_BOOKING_TOKEN' | 'EXPIRED_BOOKING_TOKEN'; message: string } {
  let tokenStr = rawInput.trim();
  if (tokenStr.startsWith('{')) {
    try {
      const parsed = JSON.parse(tokenStr);
      if (parsed.type && parsed.type !== 'LPU_BOOKING_QR') {
        return {
          valid: false,
          code: 'INVALID_BOOKING_TOKEN',
          message: 'QR code is not a valid booking check-in pass.',
        };
      }
      if (typeof parsed.token !== 'string' || !parsed.token) {
        return {
          valid: false,
          code: 'INVALID_BOOKING_TOKEN',
          message: 'Booking QR payload is missing the signed token.',
        };
      }
      tokenStr = parsed.token;
    } catch {
      return {
        valid: false,
        code: 'INVALID_BOOKING_TOKEN',
        message: 'Malformed booking QR payload.',
      };
    }
  }

  try {
    const decoded = jwt.verify(tokenStr, env.CHECKIN_TOKEN_SECRET, {
      algorithms: ['HS256'],
    }) as CheckInJwtPayload;

    if (
      decoded.typ !== 'checkin_qr' ||
      !decoded.bookingId ||
      !decoded.sub ||
      !decoded.resourceId ||
      !decoded.jti
    ) {
      return {
        valid: false,
        code: 'INVALID_BOOKING_TOKEN',
        message: 'Invalid check-in token claims.',
      };
    }

    return { valid: true, payload: decoded };
  } catch (err: any) {
    if (err?.name === 'TokenExpiredError') {
      return {
        valid: false,
        code: 'EXPIRED_BOOKING_TOKEN',
        message: 'Booking QR token has expired (5-minute limit). Please regenerate a fresh QR pass.',
      };
    }
    return {
      valid: false,
      code: 'INVALID_BOOKING_TOKEN',
      message: 'Invalid or tampered booking QR token.',
    };
  }
}
