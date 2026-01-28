const connection = require('../config/database');

const queryAsync = (sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

async function createRequest(userId, orderId, amount, reason) {
    const result = await queryAsync(
        `INSERT INTO refund_requests
         (user_id, order_id, requested_amount, reason, status)
         VALUES (?, ?, ?, ?, 'PENDING')`,
        [userId, orderId, amount, reason]
    );
    return result.insertId;
}

async function getUserRequests(userId) {
    return queryAsync(
        `SELECT rr.*, o.total_price, o.status AS order_status
         FROM refund_requests rr
         JOIN orders o ON rr.order_id = o.order_id
         WHERE rr.user_id = ?
         ORDER BY rr.created_at DESC`,
        [userId]
    );
}

async function getPendingRequests() {
    return queryAsync(
        `SELECT rr.*, u.username, u.email, o.total_price, o.status AS order_status
         FROM refund_requests rr
         JOIN users u ON rr.user_id = u.id
         JOIN orders o ON rr.order_id = o.order_id
         WHERE rr.status = 'PENDING'
         ORDER BY rr.created_at ASC`
    );
}

async function decideRequest(id, adminId, decision, adminNote) {
    return queryAsync(
        `UPDATE refund_requests
         SET status = ?, admin_id = ?, admin_note = ?, decided_at = NOW()
         WHERE id = ?`,
        [decision, adminId, adminNote || null, id]
    );
}

module.exports = {
    createRequest,
    getUserRequests,
    getPendingRequests,
    decideRequest
};
