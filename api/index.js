let appPromise;
let backendModules;

const defaultCorsOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  'https://adminpanelsoftlogic.vercel.app',
  'https://www.adminpanelsoftlogic.vercel.app',
  'https://softlogicdownloadpage.vercel.app',
  'https://www.softlogicdownloadpage.vercel.app',
  process.env.PUBLIC_APP_URL,
  process.env.PUBLIC_DOWNLOAD_PAGE_URL,
].filter(Boolean);

const parseAllowedOrigins = (value) =>
  (value ?? '')
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);

const corsAllowedOrigins = new Set([
  ...defaultCorsOrigins,
  ...parseAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS),
]);

const isAllowedCorsOrigin = (origin) =>
  !origin || corsAllowedOrigins.has(origin) || process.env.NODE_ENV === 'development';

const appendVaryOrigin = (res) => {
  const vary = res.getHeader('Vary');
  if (!vary) {
    res.setHeader('Vary', 'Origin');
    return;
  }

  const varyValue = Array.isArray(vary) ? vary.join(', ') : String(vary);
  if (!varyValue.toLowerCase().split(',').map((value) => value.trim()).includes('origin')) {
    res.setHeader('Vary', `${varyValue}, Origin`);
  }
};

const applyCorsHeaders = (req, res) => {
  const origin = req.headers.origin;
  const isAllowed = isAllowedCorsOrigin(origin);

  if (origin && isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    appendVaryOrigin(res);
  }

  if (isAllowed) {
    res.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PUT,DELETE,PATCH,OPTIONS',
    );
    res.setHeader(
      'Access-Control-Allow-Headers',
      req.headers['access-control-request-headers'] ??
        'Content-Type,Authorization,X-Requested-With',
    );
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count,X-Page,X-Per-Page');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  return isAllowed;
};

const handlePreflight = (req, res) => {
  if (req.method !== 'OPTIONS') {
    return false;
  }

  if (!applyCorsHeaders(req, res)) {
    res.statusCode = 403;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        success: false,
        data: null,
        message: 'Not allowed by CORS',
      }),
    );
    return true;
  }

  res.statusCode = 204;
  res.end();
  return true;
};

const getBackendModules = () => {
  if (!backendModules) {
    backendModules = {
      createApp: require('../dist/app').createApp,
      connectDatabase: require('../dist/config').connectDatabase,
    };
  }

  return backendModules;
};

const getApp = async () => {
  if (!appPromise) {
    appPromise = (async () => {
      const { createApp, connectDatabase } = getBackendModules();

      await connectDatabase();
      return createApp();
    })().catch((error) => {
      appPromise = undefined;
      throw error;
    });
  }

  return appPromise;
};

const sendStartupFailure = (req, res, error) => {
  if (res.headersSent) {
    return;
  }

  applyCorsHeaders(req, res);
  res.statusCode = 500;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(
    JSON.stringify({
      success: false,
      data: null,
      message:
        error instanceof Error ? error.message : 'Backend bootstrap failed',
    }),
  );
};

module.exports = async (req, res) => {
  if (handlePreflight(req, res)) {
    return;
  }

  try {
    const app = await getApp();
    await new Promise((resolve, reject) => {
      const maybePromise = app(req, res, (error) => {
        if (error != null) {
          reject(error);
          return;
        }
        resolve();
      });

      if (maybePromise != null && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve, reject);
      }
    });
  } catch (error) {
    console.error('Vercel handler failed:', error);
    sendStartupFailure(req, res, error);
  }
};
