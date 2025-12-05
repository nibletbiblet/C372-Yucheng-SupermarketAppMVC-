const Order = require('../models/Order');
const OrderItem = require('../models/OrderItem');
const connection = require('../config/database');

exports.checkoutPage = (req, res) => {
    const cart = req.session.cart || [];
    if (cart.length === 0) {
        req.flash('error', 'Your cart is empty');
        return res.redirect('/cart');
    }
    
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    
    res.render('checkout', {
        cart: cart,
        total: total,
        user: req.session.user
    });
};

exports.placeOrder = (req, res) => {
    const connection = req.app.locals.connection;
    const cart = req.session.cart || [];
    
    if (cart.length === 0) {
        req.flash('error', 'Your cart is empty');
        return res.redirect('/cart');
    }

    const userId = req.session.user.id;
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    req.session.lastOrderTotal = total;

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

                    const subtotal = item.price * item.quantity;

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

                                    console.log(`✅ Deducted ${item.quantity} from product ${item.id}`);
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
                        }
                    );
                });
            });
        });
    });
};

exports.orderSuccess = (req, res) => {
    const orderId = req.params.orderId;
    const totalAmount = req.session.lastOrderTotal || 0;
    
    res.render('success', {
        user: req.session.user,
        orderId: orderId,
        totalAmount: totalAmount
    });
    
    delete req.session.lastOrderTotal;
};

exports.viewInvoice = (req, res) => {
    const connection = req.app.locals.connection;
    const orderId = req.params.orderId;
    
    connection.query(
        'SELECT * FROM orders WHERE order_id = ?',
        [orderId],
        (err, orders) => {
            if (err || orders.length === 0) {
                req.flash('error', 'Order not found');
                return res.redirect('/checkout/orders');
            }
            
            // Fetch order items
            connection.query(
                `SELECT oi.*, p.productName, p.image 
                 FROM order_items oi 
                 JOIN products p ON oi.product_id = p.id 
                 WHERE oi.order_id = ?`,
                [orderId],
                (err, items) => {
                    if (err) {
                        console.error('Error fetching order items:', err);
                        items = [];
                    }
                    
                    res.render('invoice', {
                        user: req.session.user,
                        order: orders[0],
                        items: items,
                        invoiceNumber: orderId
                    });
                }
            );
        }
    );
};

exports.myOrders = (req, res) => {
    const connection = req.app.locals.connection;
    const userId = req.session.user.id;
    
    connection.query(
        'SELECT * FROM orders WHERE user_id = ? ORDER BY order_id DESC',
        [userId],
        (err, orders) => {
            if (err) {
                console.error('Error fetching orders:', err);
                req.flash('error', 'Failed to load orders');
                return res.redirect('/shopping');
            }
            
            res.render('orders', {
                user: req.session.user,
                orders: orders
            });
        }
    );
};

exports.reviewOrder = (req, res) => {
    const connection = req.app.locals.connection;
    const orderId = req.params.orderId;
    const userId = req.session.user.id;
    
    // Fetch order items
    connection.query(
        `SELECT oi.*, p.productName, p.image 
         FROM order_items oi 
         JOIN products p ON oi.product_id = p.id 
         WHERE oi.order_id = ?`,
        [orderId],
        (err, items) => {
            if (err || items.length === 0) {
                req.flash('error', 'Order not found');
                return res.redirect('/checkout/orders');
            }
            
            res.render('reviewOrder', {
                user: req.session.user,
                orderId: orderId,
                items: items
            });
        }
    );
};
