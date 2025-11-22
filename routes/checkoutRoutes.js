const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutController');

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to checkout');
        res.redirect('/login');
    }
};

router.get('/', checkAuthenticated, checkoutController.checkoutPage);
router.post('/', checkAuthenticated, checkoutController.placeOrder);
router.get('/success/:orderId', checkAuthenticated, checkoutController.orderSuccess);
router.get('/orders', checkAuthenticated, checkoutController.myOrders);

module.exports = router;
