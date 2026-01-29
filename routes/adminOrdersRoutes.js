const express = require('express');
const router = express.Router();
const adminOrdersController = require('../controllers/adminOrdersController');

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

router.get('/admin/orders', checkAuthenticated, checkAdmin, adminOrdersController.ordersPage);

module.exports = router;
