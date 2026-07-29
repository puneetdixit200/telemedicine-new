const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { patientsController } = require('../controllers/patients.controller');

const router = express.Router();

router.get('/me', authRequired, roleRequired('patient'), patientsController.viewMyHealth);
router.post('/me', authRequired, roleRequired('patient'), patientsController.updateMyHealth);
router.get('/notifications', authRequired, roleRequired('patient'), patientsController.listNotifications);
router.post('/notifications/:messageId/dismiss', authRequired, roleRequired('patient'), patientsController.dismissNotification);
router.get('/workspace', authRequired, roleRequired('patient'), patientsController.viewWorkspace);
router.post('/family-members', authRequired, roleRequired('patient'), patientsController.createFamilyMember);
router.post('/family-members/update', authRequired, roleRequired('patient'), patientsController.updateFamilyMember);

module.exports = router;
