const express = require('express');
const router = express.Router();
const refundRequestsController = require('../controllers/refundRequestsController');

const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in to continue');
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') return next();
    req.flash('error', 'Access denied');
    res.redirect('/shopping');
};

router.get('/admin/refunds/requests', checkAuthenticated, checkAdmin, refundRequestsController.adminRefundRequestsPage);
router.post('/admin/refunds/requests/:id/decision', checkAuthenticated, checkAdmin, refundRequestsController.decideRefundRequest);

module.exports = router;
