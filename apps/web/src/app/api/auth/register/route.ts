import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { created, fail, withErrorHandling } from '@/lib/api-response';
import { Role, DeliveryStatus } from '@prisma/client';
import { EmailService } from '@/services/emailService';
import { escapeHtml } from '@/lib/email-templates';
import env from '@/config/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  email: z.string().email().refine((val) => val.toLowerCase().endsWith('@lpu.in'), {
    message: 'Registration is restricted to official @lpu.in university emails.',
  }),
  password: z.string().min(6, 'Password must be at least 6 characters long.'),
  name: z.string().min(2, 'Name must be at least 2 characters long.'),
  role: z.enum(['STUDENT', 'FACULTY']).default('STUDENT'),
  regNo: z.string().optional(),
  department: z.string().default('School of Computer Science & Engineering'),
  designation: z.string().optional(),
  phone: z.string().optional(),
});

export const POST = withErrorHandling(async (request: Request) => {
  const body = await request.json();
  const data = registerSchema.parse(body);
  const emailLower = data.email.toLowerCase();

  const existing = await prisma.user.findUnique({
    where: { email: emailLower },
  });

  if (existing) {
    return fail(409, 'An account with this @lpu.in email already exists.');
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const verificationToken = crypto.randomBytes(32).toString('hex');
  const verificationTokenHash = crypto.createHash('sha256').update(verificationToken).digest('hex');
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  const user = await prisma.user.create({
    data: {
      email: emailLower,
      passwordHash,
      name: data.name.trim(),
      role: data.role as Role,
      regNo: data.regNo?.trim(),
      department: data.department,
      designation: data.designation,
      phone: data.phone,
      avatarUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(data.name)}`,
      emailVerified: false,
      emailVerificationTokenHash: verificationTokenHash,
      emailVerificationExpiresAt: verificationExpiresAt,
    },
  });

  const verifyUrl = `${env.APP_URL.replace(/\/+$/, '')}/verify-email?token=${verificationToken}`;
  const subject = 'Verify your LPU Campus Booking Account';
  const textBody = `Hello ${user.name},\n\nPlease verify your @lpu.in account by opening this link:\n${verifyUrl}\n\nThis link expires in 24 hours.`;
  const htmlBody = `<p>Hello ${escapeHtml(user.name)},</p><p>Please verify your @lpu.in account to activate bookings:</p><p><a href="${escapeHtml(verifyUrl)}">Verify Email Address</a></p>`;

  // Send verification email through EmailService (Nodemailer SMTP or jsonTransport in dev/test)
  const sendRes = await EmailService.send({
    to: user.email,
    subject,
    html: htmlBody,
    text: textBody,
  });

  // Record delivery in NotificationDelivery outbox
  await prisma.notificationDelivery.create({
    data: {
      userId: user.id,
      notificationType: 'EMAIL_VERIFICATION',
      scheduledFor: new Date(),
      status: sendRes.accepted ? DeliveryStatus.SENT : DeliveryStatus.FAILED,
      attemptCount: 1,
      sentAt: sendRes.accepted ? new Date() : null,
      recipientEmail: user.email,
      subject,
      htmlBody,
      textBody,
    },
  });

  return created({
    requiresEmailVerification: true,
    email: user.email,
    message: 'Registration successful! Please verify your @lpu.in email before signing in.',
  });
});
