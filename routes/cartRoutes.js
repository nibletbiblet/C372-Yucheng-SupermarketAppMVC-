const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');

// Middleware to check if user is logged in
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    } else {
        req.flash('error', 'Please log in to view cart');
        res.redirect('/login');
    }
};

router.post('/add/:id', checkAuthenticated, cartController.addToCart);
router.get('/', checkAuthenticated, cartController.viewCart);
router.post('/remove/:id', checkAuthenticated, cartController.removeFromCart);
router.post('/update/:id', checkAuthenticated, cartController.updateQuantity);
router.post('/clear', checkAuthenticated, cartController.clearCart);

module.exports = router;
