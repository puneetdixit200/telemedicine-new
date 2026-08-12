const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { callsController } = require('../controllers/calls.controller');

const router = express.Router();

router.get('/:appointmentId', authRequired, roleRequired('patient', 'doctor'), callsController.viewCall);
router.post('/:appointmentId/end', authRequired, roleRequired('patient', 'doctor'), callsController.endCall);

module.exports = router;
