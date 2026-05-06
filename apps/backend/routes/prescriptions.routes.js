const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { prescriptionsController } = require('../controllers/prescriptions.controller');

const router = express.Router();

router.get('/catalog/search', authRequired, prescriptionsController.searchMedicineCatalog);
router.get('/:appointmentId', authRequired, prescriptionsController.viewPrescription);
router.post('/:appointmentId', authRequired, roleRequired('doctor'), prescriptionsController.upsertPrescription);
router.get('/:appointmentId/pdf', authRequired, prescriptionsController.downloadPdf);

module.exports = router;
