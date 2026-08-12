const express = require('express');
const { authRequired, roleRequired } = require('../middleware/auth');
const { requireFutureBookableSlot, requireBookedAppointment } = require('../middleware/appointment-state');
const { appointmentsController } = require('../controllers/appointments.controller');

const router = express.Router();

router.get('/', authRequired, appointmentsController.listMyAppointments);
router.get('/impact', authRequired, appointmentsController.viewImpactDashboard);
router.get('/:appointmentId', authRequired, appointmentsController.viewAppointment);
router.get('/:appointmentId/presence', authRequired, appointmentsController.getPresence);

router.post('/book', authRequired, roleRequired('patient'), requireFutureBookableSlot, appointmentsController.book);
router.post('/:appointmentId/prep', authRequired, roleRequired('patient'), appointmentsController.updatePreconsult);
router.post('/:appointmentId/review', authRequired, roleRequired('patient'), appointmentsController.submitReview);
router.post('/:appointmentId/cancel', authRequired, roleRequired('patient', 'doctor', 'admin'), requireBookedAppointment, appointmentsController.cancel);
router.post('/:appointmentId/end', authRequired, roleRequired('doctor'), requireBookedAppointment, appointmentsController.endAppointment);
router.post('/:appointmentId/no-show-followup', authRequired, appointmentsController.markNoShowAndFollowUp);

module.exports = router;
