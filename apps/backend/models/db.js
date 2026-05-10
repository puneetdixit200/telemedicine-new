const { PrismaClient } = require('@prisma/client');

const isProd = process.env.NODE_ENV === 'production';

function getOptimizedDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    return undefined;
  }

  try {
    const parsed = new URL(raw);
    const isPostgres = parsed.protocol === 'postgres:' || parsed.protocol === 'postgresql:';
    if (!isPostgres) {
      return raw;
    }

    if (process.env.PRISMA_CONNECTION_LIMIT) {
      parsed.searchParams.set('connection_limit', process.env.PRISMA_CONNECTION_LIMIT);
    } else if (!parsed.searchParams.get('connection_limit')) {
      parsed.searchParams.set('connection_limit', '10');
    }

    if (!parsed.searchParams.get('pool_timeout')) {
      parsed.searchParams.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT || '30');
    }

    if (isProd && !parsed.searchParams.get('sslmode')) {
      parsed.searchParams.set('sslmode', process.env.PRISMA_SSL_MODE || 'require');
    }

    return parsed.toString();
  } catch (_error) {
    return raw;
  }
}

const optimizedDatabaseUrl = getOptimizedDatabaseUrl();

const prisma = new PrismaClient({
  log: isProd ? ['error'] : ['error', 'warn'],
  // Azure PostgreSQL Flexible Server: apply safe pool settings when not explicitly set.
  datasources: optimizedDatabaseUrl ? {
    db: {
      url: optimizedDatabaseUrl
    }
  } : undefined
});

module.exports = { prisma };
