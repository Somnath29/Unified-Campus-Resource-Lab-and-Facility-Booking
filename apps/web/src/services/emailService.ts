import nodemailer from 'nodemailer';
import env from '@/config/env';

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendEmailResult {
  accepted: boolean;
  transportMode: 'smtp' | 'json_dev';
  messageId?: string;
  error?: string;
}

export function isSmtpConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_PORT && env.SMTP_USER && env.SMTP_PASS);
}

function createTransporter() {
  if (isSmtpConfigured()) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_PORT === 465,
      auth: {
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
      },
    });
  }
  // Safe local/test fallback that renders & validates MIME without external network calls
  return nodemailer.createTransport({
    jsonTransport: true,
  });
}

// Optional test hook for verifying email dispatch in automated tests
let testEmailObserver: ((msg: SendEmailInput) => void) | null = null;
export function setTestEmailObserver(observer: ((msg: SendEmailInput) => void) | null) {
  testEmailObserver = observer;
}

export class EmailService {
  static async send(input: SendEmailInput): Promise<SendEmailResult> {
    if (testEmailObserver) {
      testEmailObserver(input);
    }

    const transporter = createTransporter();
    const transportMode: 'smtp' | 'json_dev' = isSmtpConfigured() ? 'smtp' : 'json_dev';

    try {
      const info = await transporter.sendMail({
        from: env.EMAIL_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });

      return {
        accepted: true,
        transportMode,
        messageId: info.messageId,
      };
    } catch (err: any) {
      return {
        accepted: false,
        transportMode,
        error: err?.message || 'Unknown email transport error',
      };
    }
  }
}
