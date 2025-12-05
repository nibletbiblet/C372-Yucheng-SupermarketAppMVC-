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
        const connection = req.app.locals.connection;
        const cart = req.session.cart || [];
        
        if (cart.length === 0) {
            req.flash('error', 'Your cart is empty');
            return res.redirect('/cart');
        }

        const userId = req.session.user.id;
        const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

        console.log('🛒 Placing order for user:', userId, 'Total:', total);

        connection.beginTransaction((err) => {
            if (err) {
                console.error('❌ Transaction error:', err);
                req.flash('error', 'Order failed');
                return res.redirect('/cart');
            }

            const orderSql = 'INSERT INTO orders (user_id, total_price) VALUES (?, ?)';
            connection.query(orderSql, [userId, total], (err, orderResult) => {
                if (err) {
                    return connection.rollback(() => {
                        console.error('❌ Order insert error:', err);
                        req.flash('error', 'Order placement failed');
                        res.redirect('/cart');
                    });
                }

                const orderId = orderResult.insertId;
                let processedItems = 0;

                cart.forEach((item) => {
                    connection.query('SELECT quantity FROM products WHERE id = ?', [item.id], (err, rows) => {
                        if (err || !rows || rows.length === 0) {
                            return connection.rollback(() => {
                                req.flash('error', 'Product not found: ' + item.name);
                                res.redirect('/cart');
                            });
                        }

                        const availableStock = rows[0].quantity;
                        
                        if (availableStock < item.quantity) {
                            return connection.rollback(() => {
                                req.flash('error', `Not enough stock for ${item.name}. Only ${availableStock} available.`);
                                res.redirect('/cart');
                            });
                        }

                        // Calculate subtotal
                        const subtotal = item.price * item.quantity;

                        // Insert with subtotal
                        connection.query(
                            'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
                            [orderId, item.id, item.quantity, item.price, subtotal],
                            (err) => {
                                if (err) {
                                    return connection.rollback(() => {
                                        console.error('❌ Order item error:', err);
                                        req.flash('error', 'Failed to save order items');
                                        res.redirect('/cart');
                            });
                            }

                            // ⭐ DEDUCT INVENTORY ⭐
                            connection.query(
                                'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                                [item.quantity, item.id],
                                (err) => {
                                    if (err) {
                                        return connection.rollback(() => {
                                            console.error('❌ Stock update error:', err);
                                            req.flash('error', 'Failed to update inventory');
                                            res.redirect('/cart');
                                        });
                                    }

                                    console.log(`✅ Deducted ${item.quantity} from product ${item.id} (${item.name})`);
                                    processedItems++;

                                    if (processedItems === cart.length) {
                                        connection.commit((err) => {
                                            if (err) {
                                                return connection.rollback(() => {
                                                    console.error('❌ Commit error:', err);
                                                    req.flash('error', 'Order placement failed');
                                                    res.redirect('/cart');
                                                });
                                            }

                                            console.log('✅ Order placed successfully! Order ID:', orderId);
                                            req.session.cart = [];
                                            req.flash('success', 'Order placed successfully!');
                                            res.redirect('/checkout/success/' + orderId);
                                        });
                                    }
                                }
                            );
                        });
                    });
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
