const express = require('express');
const { authRequired } = require('../middleware/auth');
const { medicinesController } = require('../controllers/medicines.controller');

const router = express.Router();

router.get('/top', authRequired, medicinesController.listTopMedicines);
router.get('/search', authRequired, medicinesController.searchMedicines);

module.exports = router;
