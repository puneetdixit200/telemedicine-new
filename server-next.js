const next = require('next');

if (process.argv.includes('--production')) {
  process.env.NODE_ENV = 'production';
}

process.env.NEXT_COMPAT_API_ONLY = 'true';

require('dotenv').config();

const { createServer } = require('./apps/backend/server/create-server');
const { logger } = require('./apps/backend/services/logger.service');
const { prisma } = require('./apps/backend/models/db');

const port = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

async function main() {
  await nextApp.prepare();

  const { app, server } = createServer();

  app.all('*', (req, res) => handle(req, res));

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Next.js telemedicine server listening on http://localhost:${port}`);
    logger.info('next.server.started', { port, nodeEnv: process.env.NODE_ENV || 'development' });
  });

  const shutdown = async (signal) => {
    logger.info('next.server.shutdown', { signal });
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
