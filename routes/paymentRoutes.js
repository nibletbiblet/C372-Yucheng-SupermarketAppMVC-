const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const netsEnsurePayment = require('../middleware/netsEnsurePayment');
const savedPaymentController = require('../controllers/savedPaymentController');
const idempotencyMiddleware = require('../middleware/idempotency');

const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    res.status(401).json({ error: 'Unauthorized' });
};

router.get('/wallet/balance', checkAuthenticated, paymentController.getWalletBalance);
router.post('/create', checkAuthenticated, idempotencyMiddleware, paymentController.createPayment);
router.post('/wallet/topup', checkAuthenticated, paymentController.walletTopup);
router.post('/bank/submit', checkAuthenticated, paymentController.bankSubmit);
router.post('/nets/qr', checkAuthenticated, paymentController.netsQr);
router.post('/callback/paypal', checkAuthenticated, paymentController.paypalCallback);
router.post('/callback/nets', checkAuthenticated, netsEnsurePayment, paymentController.netsCallback);
router.get('/callback/airwallex', paymentController.airwallexCallback);
router.get('/airwallex/status/:paymentIntentId', checkAuthenticated, paymentController.airwallexStatus);
router.post('/webhook/airwallex', paymentController.airwallexWebhook);
router.get('/callback/stripe', paymentController.stripeCallback);

router.get('/saved-methods', checkAuthenticated, savedPaymentController.listSavedMethods);
router.post('/saved-methods', checkAuthenticated, savedPaymentController.saveMethod);
router.post('/saved-methods/charge', checkAuthenticated, savedPaymentController.chargeSavedMethod);

module.exports = router;
