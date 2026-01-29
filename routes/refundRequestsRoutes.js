const express = require('express');
const router = express.Router();
const refundRequestsController = require('../controllers/refundRequestsController');

const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in to continue');
    res.redirect('/login');
};

router.get('/refunds', checkAuthenticated, refundRequestsController.refundsPage);
router.post('/refunds/request', checkAuthenticated, refundRequestsController.requestRefund);

module.exports = router;
