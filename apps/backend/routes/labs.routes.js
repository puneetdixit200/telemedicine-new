const express = require('express');
const { authRequired } = require('../middleware/auth');
const { requireValidLabTransition, requireLabReportAttachable } = require('../middleware/order-transitions');
const { labsController } = require('../controllers/labs.controller');

const router = express.Router();

router.get('/catalog', authRequired, labsController.listCatalog);
router.post('/catalog', authRequired, labsController.createCatalogTest);

router.get('/orders', authRequired, labsController.listOrders);
router.post('/orders', authRequired, labsController.createOrder);
router.get('/orders/:orderId', authRequired, labsController.viewOrder);
router.post('/orders/:orderId/status', authRequired, requireValidLabTransition, labsController.updateOrderStatus);
router.post('/orders/:orderId/report', authRequired, requireLabReportAttachable, labsController.attachReport);

module.exports = router;
