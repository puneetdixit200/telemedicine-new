const authRoutes = require('./auth.routes');
const usersRoutes = require('./users.routes');
const doctorsRoutes = require('./doctors.routes');
const patientsRoutes = require('./patients.routes');
const appointmentsRoutes = require('./appointments.routes');
const callsRoutes = require('./calls.routes');
const prescriptionsRoutes = require('./prescriptions.routes');
const documentsRoutes = require('./documents.routes');
const pharmacyRoutes = require('./pharmacy.routes');
const labsRoutes = require('./labs.routes');
const remindersRoutes = require('./reminders.routes');
const supportRoutes = require('./support.routes');
const aiRoutes = require('./ai.routes');
const healthRoutes = require('./health.routes');
const innovationRoutes = require('./innovation.routes');
const medicinesRoutes = require('./medicines.routes');

function registerApiRoutes(apiRouter) {
  apiRouter.use('/health', healthRoutes);
  apiRouter.get('/session', (req, res) =>
    res.json({
      ok: true,
      user: req.user || null,
      sessionLocation: req.cookies?.sessionLocation || null,
      requestId: req.requestId || null
    })
  );

  apiRouter.use('/auth', authRoutes);
  apiRouter.use('/users', usersRoutes);
  apiRouter.use('/doctors', doctorsRoutes);
  apiRouter.use('/patients', patientsRoutes);
  apiRouter.use('/appointments', appointmentsRoutes);
  apiRouter.use('/calls', callsRoutes);
  apiRouter.use('/prescriptions', prescriptionsRoutes);
  apiRouter.use('/documents', documentsRoutes);
  apiRouter.use('/pharmacy', pharmacyRoutes);
  apiRouter.use('/labs', labsRoutes);
  apiRouter.use('/reminders', remindersRoutes);
  apiRouter.use('/support', supportRoutes);
  apiRouter.use('/ai', aiRoutes);
  apiRouter.use('/innovations', innovationRoutes);
  apiRouter.use('/medicines', medicinesRoutes);
}

module.exports = { registerApiRoutes, documentsRoutes };
