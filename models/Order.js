const connection = require('../config/database');

class Order {
    static createOrder(userId, totalPrice, callback) {
        const sql = 'INSERT INTO orders (user_id, total_price) VALUES (?, ?)';
        connection.query(sql, [userId, totalPrice], (err, result) => {
            if (err) return callback(err);
            callback(null, result.insertId);
        });
    }

    static getOrderById(orderId, callback) {
        const sql = 'SELECT * FROM orders WHERE order_id = ?';
        connection.query(sql, [orderId], (err, results) => {
            if (err) return callback(err);
            callback(null, results[0]);
        });
    }

    static getOrdersByUserId(userId, callback) {
        const sql = `
            SELECT o.order_id, o.user_id, o.total_price, o.created_at,
                   COUNT(oi.order_item_id) as item_count
            FROM orders o
            LEFT JOIN order_items oi ON o.order_id = oi.order_id
            WHERE o.user_id = ?
            GROUP BY o.order_id, o.user_id, o.total_price, o.created_at
            ORDER BY o.created_at DESC
        `;
        connection.query(sql, [userId], (err, results) => {
            if (err) return callback(err);
            callback(null, results);
        });
    }
}

module.exports = Order;
