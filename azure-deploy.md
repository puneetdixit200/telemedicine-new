# Azure Deployment Guide

This guide documents a production-grade deployment of Telemedicine Rural App on Azure App Service.

## 1. Target Architecture

Recommended baseline:
- Azure App Service (Linux, Node 20+)
- Azure Database for PostgreSQL Flexible Server
- Azure Storage Account (Blob)
- Optional: Application Insights

Runtime flow:
1. CI builds and deploys app artifact
2. App Service starts with `bash startup.sh`
3. Startup script generates Prisma client, applies migrations, ensures frontend bundle, and starts Node server

## 2. Prerequisites

- Azure subscription
- Azure CLI installed and logged in
- GitHub repository secrets configured (if using GitHub Actions deploy)
- Valid `DATABASE_URL` for PostgreSQL

## 3. Required Azure Resources

## 3.1 App Service Plan and Web App

- Runtime: Linux
- Node: 20+
- WebSockets: enabled
- HTTPS Only: enabled
- Startup Command: `bash startup.sh`

## 3.2 PostgreSQL Flexible Server

- Public or private network connectivity from App Service
- TLS enabled
- Database user with migration privileges

## 3.3 Storage Account

- Blob container for documents (default `patient-documents`)
- Access key or connection string stored in App Settings

## 4. Application Settings

Configure in App Service > Configuration.

### 4.1 Required

- `NODE_ENV=production`
- `PORT=3000` (or platform default)
- `APP_BASE_URL=https://<your-domain>`
- `JWT_SECRET=<strong-secret>`
- `JWT_EXPIRES_IN=1d`
- `DATABASE_URL=postgresql://...`
- `AZURE_STORAGE_CONNECTION_STRING=...`
- `AZURE_STORAGE_CONTAINER=patient-documents`
- `AZURE_UPLOADS_MODE=azure-only`

### 4.2 Recommended

- `APPLICATIONINSIGHTS_CONNECTION_STRING=...`
- `AI_RATE_LIMIT_PER_MINUTE=40`
- `LOG_LEVEL=info`
- `PRISMA_CONNECTION_LIMIT=10`
- `PRISMA_POOL_TIMEOUT=30`
- `PRISMA_SSL_MODE=require`

### 4.3 Optional operational toggles

- `ENABLE_REMINDER_CRON=true`
- `REMINDER_CRON_INTERVAL_MS=300000`
- `REMINDER_CRON_BATCH_LIMIT=30`
- `ALLOW_NO_ORIGIN_SOCKET=false`
- `ADMIN_INVITE_CODE=<optional>`

### 4.4 AI host configuration

- If you do not host an Ollama-compatible endpoint, leave `OLLAMA_BASE_URL` empty.
- If hosted externally, set:
  - `OLLAMA_BASE_URL=https://<host>`
  - `OLLAMA_MODEL=<model>`
  - `OLLAMA_TIMEOUT_MS=45000`

## 5. Deployment Workflow

## 5.1 GitHub Actions recommended path

Deployment pipeline should perform:
1. Install dependencies
2. Run tests
3. Build frontend (`npm run frontend:build`)
4. Generate Prisma client
5. Apply migrations (`prisma migrate deploy`)
6. Deploy to App Service

## 5.2 Startup behavior in production

`startup.sh` executes:
1. `npx prisma generate`
2. `npx prisma migrate deploy`
3. `npm run frontend:build` if `apps/frontend/dist/index.html` is missing
4. `node app.js`

## 6. Post-Deployment Smoke Checks

Run these checks against production base URL:

```bash
curl -i https://<app>/api/health/live
curl -i https://<app>/api/health/ready
curl -i https://<app>/api/session
```

Expected:
- `/api/health/live` returns 200 with `ok=true`
- `/api/health/ready` returns 200 when DB is reachable (or 503 with readiness payload if dependency is down)
- `/api/session` returns session payload and request ID header

Also validate:
- Static SPA loads at `/`
- Deep link (for example `/dashboard`) returns SPA shell
- WebSocket signaling path works under HTTPS

## 7. Security Hardening Checklist

- Rotate all secrets before first production launch
- Use strong, unique `JWT_SECRET`
- Enforce HTTPS-only traffic
- Keep WebSockets enabled but origin-restricted via `APP_BASE_URL`
- Use Azure Blob mode in production (`AZURE_UPLOADS_MODE=azure-only`)
- Confirm no `.env` values are committed

## 8. Operations and Monitoring

Recommended monitoring signals:
- Health endpoint uptime
- App Service CPU and memory
- PostgreSQL connection count and latency
- Error rates by route group
- Reminder cron dispatch counts

If Application Insights is configured, `app.js` enables telemetry during startup.

## 9. Common Failure Modes and Fixes

### 9.1 503 frontend build not found

Symptom:
- API returns: frontend build missing

Fix:
- Run `npm run frontend:build` in CI
- Confirm `apps/frontend/dist/index.html` exists in artifact

### 9.2 Readiness failing due to database

Symptom:
- `/api/health/ready` returns 503

Fix:
- Verify `DATABASE_URL`
- Check firewall/network rules
- Verify DB credentials and migration state

### 9.3 Documents not accessible

Symptom:
- Upload/download failures in production

Fix:
- Verify storage connection string and container
- Ensure `AZURE_UPLOADS_MODE=azure-only`
- Check App Service outbound access to Azure Storage

### 9.4 Socket connection issues

Symptom:
- Call signaling instability in production

Fix:
- Verify `APP_BASE_URL` includes exact HTTPS origin(s)
- Ensure WebSockets are enabled in App Service

## 10. Rollback Strategy

Recommended rollback options:
- Use App Service deployment slots and swap rollback
- Keep previous successful artifact version
- Revert DB migrations only if safe and planned

Minimum rollback plan:
1. Stop traffic or route to maintenance page
2. Redeploy previous known-good artifact
3. Verify health endpoints
4. Re-enable traffic

## 11. Release Checklist

Before every release:
- `npm test` passes
- `npm run frontend:build` passes
- `prisma migrate deploy` succeeds on staging
- Health checks pass after deployment
- Critical patient/doctor/admin flows smoke-tested
