const RefundRequest = require('../models/RefundRequest');

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

exports.refundsPage = async (req, res) => {
    const connection = req.app.locals.connection;
    const userId = req.session.user.id;

    try {
        const orders = await queryAsync(
            connection,
            `SELECT order_id, total_price, status, created_at
             FROM orders
             WHERE user_id = ?
             ORDER BY order_id DESC
             LIMIT 10`,
            [userId]
        );
        const requests = await RefundRequest.getUserRequests(userId);

        res.render('refunds', {
            user: req.session.user,
            orders,
            requests,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    } catch (err) {
        req.flash('error', err.message);
        res.render('refunds', {
            user: req.session.user,
            orders: [],
            requests: [],
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    }
};

exports.requestRefund = async (req, res) => {
    const connection = req.app.locals.connection;
    const userId = req.session.user.id;
    const orderId = parseInt(req.body.orderId, 10);
    const amount = parseFloat(req.body.amount || 0);
    const reason = (req.body.reason || '').trim();

    if (!orderId || amount <= 0 || !reason) {
        req.flash('error', 'Please provide order ID, amount, and reason.');
        return res.redirect('/refunds');
    }

    try {
        const orders = await queryAsync(
            connection,
            'SELECT order_id, total_price, status FROM orders WHERE order_id = ? AND user_id = ?',
            [orderId, userId]
        );
        if (orders.length === 0) {
            req.flash('error', 'Order not found.');
            return res.redirect('/refunds');
        }

        const order = orders[0];
        if (!['PAID', 'HELD'].includes(order.status)) {
            req.flash('error', 'Refunds can only be requested for paid orders.');
            return res.redirect('/refunds');
        }

        const paidRows = await queryAsync(
            connection,
            `SELECT COALESCE(SUM(amount),0) AS totalPaid
             FROM payments
             WHERE order_id = ? AND user_id = ? AND status = 'SUCCEEDED'`,
            [orderId, userId]
        );
        const totalPaid = parseFloat(paidRows[0].totalPaid || 0);

        const approvedRows = await queryAsync(
            connection,
            `SELECT COALESCE(SUM(requested_amount),0) AS totalApproved
             FROM refund_requests
             WHERE order_id = ? AND status = 'APPROVED'`,
            [orderId]
        );
        const totalApproved = parseFloat(approvedRows[0].totalApproved || 0);

        if (amount > (totalPaid - totalApproved)) {
            req.flash('error', 'Requested amount exceeds paid amount.');
            return res.redirect('/refunds');
        }

        await RefundRequest.createRequest(userId, orderId, amount, reason);
        req.flash('success', 'Refund request submitted.');
        return res.redirect('/refunds');
    } catch (err) {
        req.flash('error', err.message);
        return res.redirect('/refunds');
    }
};
