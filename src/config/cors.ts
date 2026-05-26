import { CorsOptions } from 'cors';
import { env } from './env';

const adminPanelOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://adminpanelsoftlogic.vercel.app',
  'https://www.adminpanelsoftlogic.vercel.app',
];

const releasePortalOrigins = [
  'https://softlogicdownloadpage.vercel.app',
  'https://www.softlogicdownloadpage.vercel.app',
];

const parseAllowedOrigins = (value?: string): string[] =>
  value
    ?.split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean) ?? [];

const allowedOrigins = new Set([
  ...adminPanelOrigins,
  ...releasePortalOrigins,
  env.PUBLIC_APP_URL,
  env.PUBLIC_DOWNLOAD_PAGE_URL,
  ...parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
]);

export const corsConfig: CorsOptions = {
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin || allowedOrigins.has(origin) || env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Per-Page'],
  maxAge: 86400, // 24 hours
};
