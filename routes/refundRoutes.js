const express = require('express');
const router = express.Router();
const refundController = require('../controllers/refundController');

const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in to continue');
    res.redirect('/login');
};

router.get('/', checkAuthenticated, refundController.refundsPage);
router.post('/request', checkAuthenticated, refundController.requestRefund);

module.exports = router;
