import { z } from "zod";
import dotenv from "dotenv";

const runtimeNodeEnv = process.env.NODE_ENV?.trim() || "development";
dotenv.config({ path: `.env.${runtimeNodeEnv}` });
dotenv.config();

if (!process.env.DATABASE_URL?.trim()) {
  process.env.DATABASE_URL =
    process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL;
}

const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional(),
);

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

const envSchema = z
  .object({
    // Server
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    PORT: z.coerce.number().default(3000),
    API_VERSION: z.string().default("v1"),
    CORS_ALLOWED_ORIGINS: optionalString,

    // Database
    DATABASE_URL: z.string().url(),

    // Redis
    REDIS_URL: z.string().default("redis://localhost:6379"),

    // JWT
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_REFRESH_SECRET: z.string().min(32),
    JWT_ACCESS_EXPIRES_IN: z.string().default("15m"),
    JWT_REFRESH_EXPIRES_IN: z.string().default("7d"),
    SEED_SUPER_ADMIN_EMAIL: z
      .string()
      .email()
      .default("admin@softlogicwhiteboard.com"),
    SEED_SUPER_ADMIN_NAME: z.string().default("Softlogic Super Admin"),

    // Google OAuth
    GOOGLE_CLIENT_ID: optionalString,
    GOOGLE_CLIENT_SECRET: optionalString,
    GOOGLE_OAUTH_REDIRECT_URI: optionalUrl,

    // Email
    SMTP_HOST: z.string().default("smtp.gmail.com"),
    SMTP_PORT: z.coerce.number().default(587),
    SMTP_USER: optionalString,
    SMTP_PASS: optionalString,
    EMAIL_FROM: z.string().default("noreply@softlogicwhiteboard.com"),
    EMAIL_FROM_NAME: z.string().default("Softlogic Whiteboard"),
    EMAIL_PROVIDER: z.enum(["smtp", "brevo"]).default("smtp"),
    BREVO_API_KEY: optionalString,
    BREVO_API_URL: z
      .string()
      .url()
      .default("https://api.brevo.com/v3/smtp/email"),
    BREVO_FROM_EMAIL: optionalString,
    BREVO_FROM_NAME: optionalString,
    DEV_FIXED_OTP_ENABLED: booleanFromEnv.default(false),
    DEV_FIXED_OTP_CODE: z
      .string()
      .regex(/^\d{4}$/)
      .optional(),
    DEV_FIXED_OTP_ALLOWED_EMAILS: optionalString,
    TESTING_RELAX_AUTH_LIMITS: booleanFromEnv.default(false),

    // Cloudinary
    CLOUDINARY_CLOUD_NAME: optionalString,
    CLOUDINARY_API_KEY: optionalString,
    CLOUDINARY_API_SECRET: optionalString,

    // Live sessions / RTC
    LIVEKIT_URL: optionalUrl,
    LIVEKIT_API_KEY: optionalString,
    LIVEKIT_API_SECRET: optionalString,
    TURN_URLS: optionalString,
    TURN_USERNAME: optionalString,
    TURN_CREDENTIAL: optionalString,
    PUBLIC_DOWNLOAD_PAGE_URL: z
      .string()
      .url()
      .default("https://softlogicwhiteboard.com/download"),
    PUBLIC_APP_URL: z.string().url().default("https://softlogicwhiteboard.com"),
    PUBLIC_ADMIN_URL: z
      .string()
      .url()
      .default("https://adminpanelsoftlogic.vercel.app"),

    // External content providers
    SERPER_API_KEY: optionalString,
    GOOGLE_SEARCH_API_KEY: optionalString,
    GOOGLE_SEARCH_CX: optionalString,
    GOOGLE_TRANSLATE_API_KEY: optionalString,
    YOUTUBE_API_KEY: optionalString,
    DROPBOX_CLIENT_ID: optionalString,
    DROPBOX_CLIENT_SECRET: optionalString,
    GOOGLE_DRIVE_CLIENT_ID: optionalString,
    GOOGLE_DRIVE_CLIENT_SECRET: optionalString,
    GOOGLE_DRIVE_REDIRECT_URI: optionalUrl,
    ONEDRIVE_CLIENT_ID: optionalString,
    ONEDRIVE_CLIENT_SECRET: optionalString,
    ONEDRIVE_REDIRECT_URI: optionalUrl,

    // Activation key encryption (AES-256-GCM). Provide 32+ chars in production.
    ACTIVATION_KEY_CIPHER_SECRET: optionalString,

    // Secret used to authorize scheduled cron jobs (e.g. Vercel cron subscription sweep).
    // The cron caller must send `Authorization: Bearer <CRON_SECRET>`.
    CRON_SECRET: z.string().default("dev-cron-secret-change-me"),

    // Google Cloud Billing verification for AI spend. Service account JSON stays on the server only.
    GOOGLE_BILLING_SYNC_ENABLED: booleanFromEnv.default(false),
    GOOGLE_BILLING_PROJECT_ID: z.string().default("softlogic-496310"),
    GOOGLE_BILLING_TABLE_PROJECT_ID: optionalString,
    GOOGLE_BILLING_DATASET_ID: optionalString,
    GOOGLE_BILLING_TABLE_NAME: optionalString,
    GOOGLE_BILLING_MONTHLY_CAP_MICROS: z.coerce
      .number()
      .int()
      .positive()
      .default(50000000),
    GOOGLE_BILLING_SERVICE_ACCOUNT_PATH: optionalString,

    // S3-compatible storage placeholders for production file/recording storage
    STORAGE_BUCKET: optionalString,
    STORAGE_REGION: optionalString,
    STORAGE_ENDPOINT: optionalUrl,
    STORAGE_ACCESS_KEY_ID: optionalString,
    STORAGE_SECRET_ACCESS_KEY: optionalString,
    STORAGE_PUBLIC_BASE_URL: optionalUrl,
    MINIO_ENDPOINT: optionalString,
    MINIO_PORT: optionalString,
    MINIO_ACCESS_KEY: optionalString,
    MINIO_SECRET_KEY: optionalString,
    MINIO_BUCKET: optionalString,
    MINIO_REGION: optionalString,
    MINIO_PUBLIC_BASE_URL: optionalUrl,

    // Whiteboard document import conversion
    IMPORT_CONVERSION_WORKER_URL: optionalUrl,
    IMPORT_CONVERSION_WORKER_TOKEN: optionalString,
    CONVERTAPI_TOKEN: optionalString,
    CONVERTAPI_BASE_URL: z.string().url().default("https://v2.convertapi.com"),

    // Storage
    STORAGE_TYPE: z.enum(["minio", "s3", "cloudinary"]).default("cloudinary"),

    // Rate Limiting
    RATE_LIMIT_WINDOW_MS: z.coerce.number().default(900000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().default(100),

    // Profanity
    PROFANITY_ENABLED: booleanFromEnv.default(true),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === "production" && value.DEV_FIXED_OTP_ENABLED) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEV_FIXED_OTP_ENABLED"],
        message:
          "DEV_FIXED_OTP_ENABLED must be false in production. Real OTP verification is required.",
      });
    }
  });

export type EnvConfig = z.infer<typeof envSchema>;

const parseEnv = (): EnvConfig => {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("❌ Invalid environment variables:");
    console.error(parsed.error.format());
    process.exit(1);
  }

  return parsed.data;
};

export const env = parseEnv();
export const isDevelopment = env.NODE_ENV === "development";
export const isProduction = env.NODE_ENV === "production";
export const isTest = env.NODE_ENV === "test";
