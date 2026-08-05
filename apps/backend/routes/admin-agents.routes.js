const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { adminAgentsController } = require('../controllers/admin-agents.controller');

const router = express.Router();
router.use(authRequired, roleRequired('admin'));
router.get('/realtime-token', adminAgentsController.realtimeToken);
router.get('/overview', adminAgentsController.overview);
router.get('/traces', adminAgentsController.traces);
router.get('/traces/:traceId', adminAgentsController.trace);
router.get('/traces/:traceId/events', adminAgentsController.events);
router.get('/events', adminAgentsController.events);
router.get('/runs/:runId', adminAgentsController.run);
router.post('/runs/:runId/start', adminAgentsController.start);
router.post('/runs/:runId/approve-and-continue', adminAgentsController.approveAndContinue);
router.post('/runs/:runId/approve-and-run', adminAgentsController.approveAndRun);
router.get('/metrics', adminAgentsController.metrics);
router.get('/integrity', adminAgentsController.integrity);
router.post('/integrity/reconcile/:traceId', adminAgentsController.reconcile);

module.exports = router;
