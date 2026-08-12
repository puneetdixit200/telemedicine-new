const { prisma } = require('../models/db');

const PHARMACY_TRANSITIONS = Object.freeze({
  placed: new Set(['processing', 'cancelled']),
  processing: new Set(['ready', 'cancelled']),
  ready: new Set(['delivered', 'cancelled']),
  delivered: new Set(),
  cancelled: new Set()
});

const LAB_TRANSITIONS = Object.freeze({
  requested: new Set(['sample_collected', 'cancelled']),
  sample_collected: new Set(['processing', 'cancelled']),
  processing: new Set(['report_ready', 'cancelled']),
  report_ready: new Set(['completed']),
  completed: new Set(),
  cancelled: new Set()
});

function canTransition(map, currentStatus, nextStatus) {
  const allowed = map[String(currentStatus || '')];
  return Boolean(allowed && allowed.has(String(nextStatus || '')));
}

async function requireValidPharmacyTransition(req, res, next) {
  try {
    const requestedStatus = String(req.body?.status || '').trim();
    if (!requestedStatus || !Object.prototype.hasOwnProperty.call(PHARMACY_TRANSITIONS, requestedStatus)) {
      return next();
    }

    const order = await prisma.pharmacyOrder.findUnique({
      where: { id: req.params.orderId },
      select: { id: true, status: true }
    });
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (!canTransition(PHARMACY_TRANSITIONS, order.status, requestedStatus)) {
      return res.status(409).json({
        error: `Invalid pharmacy order transition from ${order.status} to ${requestedStatus}.`
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireValidLabTransition(req, res, next) {
  try {
    const requestedStatus = String(req.body?.status || '').trim();
    if (!requestedStatus || !Object.prototype.hasOwnProperty.call(LAB_TRANSITIONS, requestedStatus)) {
      return next();
    }

    const order = await prisma.labOrder.findUnique({
      where: { id: req.params.orderId },
      select: { id: true, status: true, reportDocumentId: true }
    });
    if (!order) return res.status(404).json({ error: 'Lab order not found.' });

    if (!canTransition(LAB_TRANSITIONS, order.status, requestedStatus)) {
      return res.status(409).json({
        error: `Invalid lab order transition from ${order.status} to ${requestedStatus}.`
      });
    }

    if ((requestedStatus === 'report_ready' || requestedStatus === 'completed') && !order.reportDocumentId) {
      return res.status(409).json({ error: 'A PDF lab report must be linked before this status can be set.' });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

async function requireLabReportAttachable(req, res, next) {
  try {
    const order = await prisma.labOrder.findUnique({
      where: { id: req.params.orderId },
      select: { id: true, status: true }
    });
    if (!order) return res.status(404).json({ error: 'Lab order not found.' });

    if (!['processing', 'report_ready'].includes(order.status)) {
      return res.status(409).json({
        error: 'A report can be linked only after the lab order reaches processing.'
      });
    }

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  PHARMACY_TRANSITIONS,
  LAB_TRANSITIONS,
  canTransition,
  requireValidPharmacyTransition,
  requireValidLabTransition,
  requireLabReportAttachable
};
