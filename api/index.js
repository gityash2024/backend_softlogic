const { createApp } = require('../dist/app');
const { connectDatabase } = require('../dist/config');

let appPromise;

const getApp = async () => {
  appPromise ??= (async () => {
    await connectDatabase();
    return createApp();
  })();

  return appPromise;
};

const sendStartupFailure = (res, error) => {
  if (res.headersSent) {
    return;
  }

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
    sendStartupFailure(res, error);
  }
};
