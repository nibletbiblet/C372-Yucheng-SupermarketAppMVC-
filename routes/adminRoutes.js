const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    return res.status(401).json({ error: 'Unauthorized' });
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Forbidden' });
};

router.get('/payments', checkAuthenticated, checkAdmin, adminController.paymentsPage);
router.get('/payments/data', checkAuthenticated, checkAdmin, adminController.listPayments);
router.post('/refund/:txnId', checkAuthenticated, checkAdmin, adminController.refundPaymentFromDashboard);
router.post('/refunds', checkAuthenticated, checkAdmin, adminController.createRefund);
router.get('/disputes', checkAuthenticated, checkAdmin, adminController.listDisputes);
router.post('/disputes/:id/resolve', checkAuthenticated, checkAdmin, adminController.resolveDispute);
router.get('/risk', checkAuthenticated, checkAdmin, adminController.listRisk);
router.post('/risk/:orderId/decision', checkAuthenticated, checkAdmin, adminController.decideRisk);
router.get('/revenue', checkAuthenticated, checkAdmin, adminController.revenue);

module.exports = router;
