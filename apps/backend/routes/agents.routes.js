const express = require('express');
const rateLimit = require('express-rate-limit');
const { authRequired } = require('../middleware/auth');
const { agentsController } = require('../controllers/agents.controller');

const router = express.Router();

const planLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: 'Agent plan request limit reached. Please retry in a moment.',
    code: 'AGENT_RATE_LIMITED'
  }
});

router.use(authRequired);

router.post('/no-show/:appointmentId/plan', planLimiter, agentsController.createNoShowPlan);
router.post('/post-visit/:appointmentId/plan', planLimiter, agentsController.createPostVisitPlan);

router.get('/runs/:runId', agentsController.getRun);
router.post('/runs/:runId/approve', agentsController.approve);
router.post('/runs/:runId/reject', agentsController.reject);
router.post('/runs/:runId/execute', agentsController.execute);

module.exports = router;
