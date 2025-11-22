const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem');

const checkoutController = {
    checkoutPage: (req, res) => {
        const cart = req.session.cart || [];
        const user = req.session.user;

        if (cart.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }

        let total = 0;
        cart.forEach(item => {
            total += item.price * item.quantity;
        });

        res.render('checkout', { 
            cart, 
            user, 
            total,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    },

    placeOrder: (req, res) => {
        const cart = req.session.cart || [];
        const user = req.session.user;

        if (!user) {
            req.flash('error', 'Please login to place an order');
            return res.redirect('/login');
        }

        if (cart.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }

        // Calculate total
        let totalPrice = 0;
        cart.forEach(item => {
            totalPrice += item.price * item.quantity;
        });

        // Create order
        Order.createOrder(user.id, totalPrice, (err, orderId) => {
            if (err) {
                console.error('Error creating order:', err);
                req.flash('error', 'Failed to place order');
                return res.redirect('/checkout');
            }

            // Add order items
            let itemsProcessed = 0;
            cart.forEach(item => {
                const subtotal = item.price * item.quantity;
                OrderItem.addItem(orderId, item.id, item.quantity, item.price, subtotal, (err) => {
                    if (err) {
                        console.error('Error adding order item:', err);
                    }
                    itemsProcessed++;

                    if (itemsProcessed === cart.length) {
                        // Clear cart
                        req.session.cart = [];
                        // Redirect to success page
                        res.redirect('/checkout/success/' + orderId);
                    }
                });
            });
        });
    },

    orderSuccess: (req, res) => {
        const orderId = req.params.orderId;
        const user = req.session.user;

        Order.getOrderById(orderId, (err, order) => {
            if (err || !order) {
                return res.redirect('/shopping');
            }

            OrderItem.getItemsByOrderId(orderId, (err, items) => {
                if (err) {
                    items = [];
                }

                res.render('orderSuccess', { 
                    user, 
                    order,
                    items
                });
            });
        });
    },

    myOrders: (req, res) => {
        const user = req.session.user;

        if (!user) {
            req.flash('error', 'Please login to view orders');
            return res.redirect('/login');
        }

        Order.getOrdersByUserId(user.id, (err, orders) => {
            if (err) {
                console.error('Error fetching orders:', err);
                orders = [];
            }

            res.render('myOrders', { 
                user, 
                orders
            });
        });
    }
};

module.exports = checkoutController;
