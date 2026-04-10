import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  API_VERSION: z.string().default('v1'),

  // Database
  DATABASE_URL: z.string().url(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  SEED_SUPER_ADMIN_EMAIL: z.string().email().default('admin@softlogicwhiteboard.com'),
  SEED_SUPER_ADMIN_NAME: z.string().default('Softlogic Super Admin'),

  // Google OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().url().optional(),

  // Email
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().default('noreply@softlogicwhiteboard.com'),
  EMAIL_FROM_NAME: z.string().default('Softlogic Whiteboard'),
  DEV_FIXED_OTP_ENABLED: z.coerce.boolean().default(false),
  DEV_FIXED_OTP_CODE: z.string().regex(/^\d{4}$/).optional(),
  DEV_FIXED_OTP_ALLOWED_EMAILS: z.string().optional(),
  TESTING_RELAX_AUTH_LIMITS: z.coerce.boolean().default(false),

  // Cloudinary
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  // Whiteboard document import conversion
  IMPORT_CONVERSION_WORKER_URL: z.string().url().optional(),
  IMPORT_CONVERSION_WORKER_TOKEN: z.string().optional(),

  // Storage
  STORAGE_TYPE: z.enum(['minio', 's3', 'cloudinary']).default('cloudinary'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

  // Profanity
  PROFANITY_ENABLED: z.coerce.boolean().default(true),
});

export type EnvConfig = z.infer<typeof envSchema>;

const parseEnv = (): EnvConfig => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error('❌ Invalid environment variables:');
    console.error(parsed.error.format());
    process.exit(1);
  }

  return parsed.data;
};

export const env = parseEnv();
