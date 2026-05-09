const express = require('express');
const { prisma } = require('../models/db');

const router = express.Router();
const SERVICE_NAME = String(process.env.SERVICE_NAME || 'telemedicine-rural-api');
const READINESS_TIMEOUT_MS = Math.max(100, Number(process.env.READINESS_TIMEOUT_MS || 5000));

function nowIso() {
  return new Date().toISOString();
}

function requestId(req) {
  return req.requestId || null;
}

function withTimeout(promise, timeoutMs) {
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      const timeoutError = new Error('Readiness dependency check timed out');
      timeoutError.code = 'READINESS_TIMEOUT';
      reject(timeoutError);
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutHandle);
  });
}

router.get('/live', (req, res) => {
  return res.json({
    ok: true,
    status: 'live',
    overallStatus: 'live',
    service: SERVICE_NAME,
    uptimeSeconds: Math.floor(process.uptime()),
    checks: {
      process: {
        status: 'up'
      }
    },
    timestamp: nowIso(),
    requestId: requestId(req)
  });
});

router.get('/ready', async (req, res) => {
  const startedAtMs = Date.now();
  const databaseCheck = {
    status: 'unknown',
    timeoutMs: READINESS_TIMEOUT_MS,
    latencyMs: 0
  };

  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, READINESS_TIMEOUT_MS);
    databaseCheck.status = 'up';
    databaseCheck.latencyMs = Date.now() - startedAtMs;

    return res.json({
      ok: true,
      status: 'ready',
      overallStatus: 'ready',
      service: SERVICE_NAME,
      policy: {
        mode: 'strict',
        timeoutMs: READINESS_TIMEOUT_MS,
        fallback: 'serve_503_until_dependency_recovers'
      },
      checks: {
        database: databaseCheck
      },
      timestamp: nowIso(),
      requestId: requestId(req)
    });
  } catch (error) {
    const timedOut = error && error.code === 'READINESS_TIMEOUT';
    databaseCheck.status = timedOut ? 'timeout' : 'down';
    databaseCheck.latencyMs = Date.now() - startedAtMs;
    databaseCheck.error = timedOut ? 'timeout_exceeded' : 'connection_failed';

    return res.status(503).json({
      ok: false,
      status: 'not_ready',
      overallStatus: 'not_ready',
      error: 'Service not ready',
      code: 'SERVICE_UNAVAILABLE',
      service: SERVICE_NAME,
      alert: {
        severity: 'critical',
        summary: 'Readiness check failed for database dependency'
      },
      policy: {
        mode: 'strict',
        timeoutMs: READINESS_TIMEOUT_MS,
        fallback: 'serve_503_until_dependency_recovers'
      },
      checks: {
        database: databaseCheck
      },
      timestamp: nowIso(),
      requestId: requestId(req)
    });
  }
});

module.exports = router;
