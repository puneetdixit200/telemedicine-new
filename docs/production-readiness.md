# Production Readiness Checklist

Use this checklist before every production release.

## 1. Release Gate Summary

A release is production-ready only if all sections below are green:
- Security and secrets
- Infrastructure and configuration
- Data and migrations
- Build and tests
- Runtime behavior
- Observability and operations
- Rollback preparedness

## 2. Security and Secret Management

## 2.1 Required checks

- [ ] `.env` is not committed
- [ ] All production secrets are sourced from platform configuration
- [ ] `JWT_SECRET` is strong and rotated as needed
- [ ] Azure storage credentials are valid and not leaked
- [ ] `APP_BASE_URL` is set to correct HTTPS origin(s)

## 2.2 App-level protections

- [ ] Helmet CSP enabled
- [ ] Global rate limiting enabled
- [ ] Secure cookie behavior verified in production
- [ ] Unauthorized access returns proper auth errors

## 3. Infrastructure and Configuration

## 3.1 Required app settings

- [ ] `NODE_ENV=production`
- [ ] `DATABASE_URL` configured
- [ ] `APP_BASE_URL` configured
- [ ] `AZURE_STORAGE_CONNECTION_STRING` configured
- [ ] `AZURE_STORAGE_CONTAINER` configured
- [ ] `AZURE_UPLOADS_MODE=azure-only`

## 3.2 Platform settings

- [ ] HTTPS Only enabled
- [ ] WebSockets enabled
- [ ] Startup command set to `bash startup.sh`

## 4. Data and Migration Safety

- [ ] `npx prisma generate` succeeds
- [ ] `npx prisma migrate deploy` succeeds
- [ ] Migration plan reviewed for breaking changes
- [ ] Rollback strategy reviewed for schema changes

## 5. Build and Test Gates

Run and verify:

```bash
npm test
npm run frontend:build
```

Required outcomes:
- [ ] All tests pass
- [ ] Frontend build succeeds
- [ ] No blocker errors in runtime logs during startup

## 6. Runtime Health and Smoke Tests

## 6.1 Health endpoints

- [ ] `GET /api/health/live` returns 200
- [ ] `GET /api/health/ready` returns 200 (or expected 503 with dependency-failure payload)

## 6.2 Session and shell

- [ ] `GET /api/session` returns expected schema and request ID
- [ ] SPA root and deep links render correctly

## 6.3 Critical workflow smoke tests

- [ ] Patient login -> booking -> appointment detail -> prescription view
- [ ] Doctor login -> slots -> appointment handling -> prescription save
- [ ] Profile action center controls visible and functional by role
- [ ] AI Help button-first feature launcher functions as expected
- [ ] Pharmacy and lab routes load and update status as permitted

## 7. Storage and Document Behavior

- [ ] Upload works in production mode
- [ ] Document preview ACL works for allowed users
- [ ] Unauthorized download/preview is blocked
- [ ] No dependency on ephemeral local disk for production documents

## 8. AI and Reminder Operations

## 8.1 AI baseline

- [ ] AI endpoints are auth-protected and rate-limited
- [ ] AI outputs remain marked as review-required in UI/payload
- [ ] Fallback behavior verified when AI host is unavailable

## 8.2 Reminder baseline

- [ ] Reminder routes are accessible with proper roles
- [ ] Optional cron settings validated if enabled
- [ ] Dispatch behavior and logs confirmed in staging

## 9. Observability and Monitoring

- [ ] Request IDs present in responses and logs
- [ ] Structured logs available in platform log pipeline
- [ ] Application Insights configured (if used)
- [ ] Alerts configured for health/readiness failures

## 10. Rollback Preparedness

- [ ] Previous known-good deployment artifact is available
- [ ] Slot-based or versioned rollback path is documented
- [ ] Team knows rollback owner and escalation path
- [ ] Post-rollback smoke checks are documented

## 11. Go/No-Go Decision Template

Go if:
- All mandatory checkboxes are complete
- No unresolved critical severity incidents
- Monitoring and on-call coverage are confirmed

No-Go if:
- Any security, migration, or health readiness blocker remains
- Rollback path is not verified

## 12. Recommended Pre-Release Command Set

```bash
npm install
npm run prisma:generate
npm run db:deploy
npm test
npm run frontend:build
```

## 13. Post-Release Verification

Immediately after deployment:
- [ ] Validate health endpoints
- [ ] Validate session endpoint
- [ ] Confirm at least one patient and one doctor critical path
- [ ] Confirm no spike in auth or server errors
