import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().min(1, 'DIRECT_URL is required for migrations'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters long'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CRON_SECRET: z.string().min(1, 'CRON_SECRET is required'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:5173,http://localhost:5174'),
  ENABLE_DEMO_LOGIN: z
    .string()
    .transform((val) => val === 'true')
    .or(z.boolean())
    .default(false),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CANCELLATION_CUTOFF_MINUTES: z.coerce.number().int().nonnegative().default(60),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_INITIAL_PASSWORD: z.string().min(8).optional(),
});

export type Env = z.infer<typeof envSchema>;

function validateEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    console.error('\n❌ FATAL: Invalid or missing environment configuration:\n' + errorDetails + '\n');
    process.exit(1);
  }

  return parsed.data;
}

export const env = validateEnv();
export default env;
