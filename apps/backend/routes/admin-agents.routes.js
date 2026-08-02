const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { adminAgentsController } = require('../controllers/admin-agents.controller');

const router = express.Router();
router.use(authRequired, roleRequired('admin'));
router.get('/overview', adminAgentsController.overview);
router.get('/traces', adminAgentsController.traces);
router.get('/traces/:traceId', adminAgentsController.trace);
router.get('/traces/:traceId/events', adminAgentsController.events);
router.get('/events', adminAgentsController.events);
router.get('/runs/:runId', adminAgentsController.run);
router.get('/metrics', adminAgentsController.metrics);

module.exports = router;
