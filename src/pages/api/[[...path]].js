const { createApp } = require('../../../apps/backend/server/create-app');

export const config = {
  api: {
    bodyParser: false,
    externalResolver: true
  }
};

let compatibilityApp;

function getCompatibilityApp() {
  if (!compatibilityApp) {
    process.env.NEXT_COMPAT_API_ONLY = 'true';
    compatibilityApp = createApp();
  }
  return compatibilityApp;
}

export default function handler(req, res) {
  if (req.url && !req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }

  return getCompatibilityApp()(req, res);
}
