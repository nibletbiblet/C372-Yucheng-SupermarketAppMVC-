const connection = require('../config/database');

class OrderItem {
    static addItem(orderId, productId, quantity, price, subtotal, callback) {
        const sql = 'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)';
        connection.query(sql, [orderId, productId, quantity, price, subtotal], (err, result) => {
            if (err) return callback(err);
            callback(null, result);
        });
    }

    static getItemsByOrderId(orderId, callback) {
        const sql = `
            SELECT oi.*, p.productName, p.image
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = ?
        `;
        connection.query(sql, [orderId], (err, results) => {
            if (err) return callback(err);
            callback(null, results);
        });
    }
}

module.exports = OrderItem;
