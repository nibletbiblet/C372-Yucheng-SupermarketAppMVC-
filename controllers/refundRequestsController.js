const RefundRequest = require('../models/RefundRequest');
const walletService = require('../services/walletService');

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

        res.render('refunds_new', {
            user: req.session.user,
            orders,
            requests,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    } catch (err) {
        req.flash('error', err.message);
        res.render('refunds_new', {
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

    if (!orderId || !amount || amount <= 0 || !reason) {
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
        if (!['PAID', 'HELD'].includes(String(order.status || '').toUpperCase())) {
            req.flash('error', 'Refunds can only be requested for paid orders.');
            return res.redirect('/refunds');
        }

        const pendingRows = await queryAsync(
            connection,
            `SELECT COUNT(*) AS pendingCount
             FROM refund_requests
             WHERE order_id = ? AND user_id = ? AND status = 'PENDING'`,
            [orderId, userId]
        );
        if (pendingRows[0] && pendingRows[0].pendingCount > 0) {
            req.flash('error', 'A refund request for this order is already pending.');
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
        const orderTotal = parseFloat(order.total_price || 0);
        const maxRefundable = Math.min(orderTotal, totalPaid);

        if (amount > maxRefundable) {
            req.flash('error', 'Requested amount exceeds paid total.');
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

exports.adminRefundRequestsPage = async (req, res) => {
    try {
        const requests = await RefundRequest.getPendingRequests();
        res.render('adminRefundRequests_new', {
            user: req.session.user,
            requests,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    } catch (err) {
        req.flash('error', err.message);
        res.render('adminRefundRequests_new', {
            user: req.session.user,
            requests: [],
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    }
};

exports.decideRefundRequest = async (req, res) => {
    const connection = req.app.locals.connection;
    const requestId = parseInt(req.params.id, 10);
    const decision = (req.body.decision || '').toUpperCase();
    const adminNote = (req.body.adminNote || '').trim();

    if (!requestId || !['APPROVE', 'DENY'].includes(decision)) {
        req.flash('error', 'Invalid refund decision.');
        return res.redirect('/admin/refunds/requests');
    }

    try {
        const rows = await queryAsync(
            connection,
            'SELECT * FROM refund_requests WHERE id = ?',
            [requestId]
        );
        if (rows.length === 0) {
            req.flash('error', 'Refund request not found.');
            return res.redirect('/admin/refunds/requests');
        }

        const refund = rows[0];
        if (refund.status !== 'PENDING') {
            req.flash('error', 'Refund request already decided.');
            return res.redirect('/admin/refunds/requests');
        }

        if (decision === 'DENY') {
            await RefundRequest.decideRequest(requestId, req.session.user.id, 'DENIED', adminNote);
            req.flash('success', 'Refund request denied.');
            return res.redirect('/admin/refunds/requests');
        }

        const paidRows = await queryAsync(
            connection,
            `SELECT COALESCE(SUM(amount),0) AS totalPaid
             FROM payments
             WHERE order_id = ? AND user_id = ? AND status = 'SUCCEEDED'`,
            [refund.order_id, refund.user_id]
        );
        const totalPaid = parseFloat(paidRows[0].totalPaid || 0);

        const approvedRows = await queryAsync(
            connection,
            `SELECT COALESCE(SUM(requested_amount),0) AS totalApproved
             FROM refund_requests
             WHERE order_id = ? AND status = 'APPROVED'`,
            [refund.order_id]
        );
        const totalApproved = parseFloat(approvedRows[0].totalApproved || 0);

        if (refund.requested_amount > (totalPaid - totalApproved)) {
            req.flash('error', 'Refund amount exceeds paid amount.');
            return res.redirect('/admin/refunds/requests');
        }

        await walletService.credit(connection, refund.user_id, parseFloat(refund.requested_amount), {
            type: 'REFUND',
            orderId: refund.order_id,
            refType: 'REFUND_REQUEST',
            refId: refund.id
        });

        await RefundRequest.decideRequest(requestId, req.session.user.id, 'APPROVED', adminNote);
        req.flash('success', 'Refund approved and credited to wallet.');
        return res.redirect('/admin/refunds/requests');
    } catch (err) {
        req.flash('error', err.message);
        return res.redirect('/admin/refunds/requests');
    }
};
