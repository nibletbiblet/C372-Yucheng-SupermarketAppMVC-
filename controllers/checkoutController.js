const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem');
const connection = require('../config/database');

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

        let totalPrice = 0;
        cart.forEach(item => {
            totalPrice += item.price * item.quantity;
        });

        Order.createOrder(user.id, totalPrice, (err, orderId) => {
            if (err) {
                console.error('Error creating order:', err);
                req.flash('error', 'Failed to place order. Please try again.');
                return res.redirect('/checkout');
            }

            let itemsProcessed = 0;
            const itemCount = cart.length;

            cart.forEach(item => {
                const subtotal = item.price * item.quantity;
                OrderItem.addItem(orderId, item.id, item.quantity, item.price, subtotal, (err) => {
                    if (err) {
                        console.error('Error adding order item:', err);
                    }
                    itemsProcessed++;

                    if (itemsProcessed === itemCount) {
                        req.session.cart = [];
                        req.session.save((saveErr) => {
                            if (saveErr) {
                                console.error('Session save error:', saveErr);
                            }
                            console.log('Order placed successfully. Order ID:', orderId);
                            res.redirect('/checkout/success/' + orderId);
                        });
                    }
                });
            });
        });
    },

    orderSuccess: (req, res) => {
        const orderId = req.params.orderId;
        const user = req.session.user;

        if (!user) {
            return res.redirect('/login');
        }

        Order.getOrderById(orderId, (err, order) => {
            if (err || !order) {
                console.error('Order not found:', err);
                req.flash('error', 'Order not found');
                return res.redirect('/shopping');
            }

            if (order.user_id !== user.id) {
                req.flash('error', 'Access denied');
                return res.redirect('/shopping');
            }

            OrderItem.getItemsByOrderId(orderId, (err, items) => {
                if (err) {
                    console.error('Error fetching order items:', err);
                    items = [];
                }

                res.render('orderSuccess', { 
                    user, 
                    order,
                    items,
                    messages: req.flash('success'),
                    errors: req.flash('error')
                });
            });
        });
    },

    viewInvoice: (req, res) => {
        const orderId = req.params.orderId;
        const user = req.session.user;

        if (!user) {
            req.flash('error', 'Please login to view invoice');
            return res.redirect('/login');
        }

        console.log('Fetching invoice for order:', orderId, 'user:', user.id);

        Order.getOrderById(orderId, (err, order) => {
            if (err || !order) {
                console.error('Order not found:', err);
                req.flash('error', 'Invoice not found');
                return res.redirect('/shopping');
            }

            console.log('Order found:', order);

            if (order.user_id !== user.id) {
                req.flash('error', 'Access denied');
                return res.redirect('/shopping');
            }

            OrderItem.getItemsByOrderId(orderId, (err, items) => {
                if (err) {
                    console.error('Error fetching items:', err);
                    items = [];
                }

                console.log('Order items:', items);

                res.render('invoice', { 
                    user, 
                    order,
                    items,
                    invoiceNumber: `INV-${String(orderId).padStart(6, '0')}`
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
                orders,
                messages: req.flash('success'),
                errors: req.flash('error')
            });
        });
    }
};

module.exports = checkoutController;
