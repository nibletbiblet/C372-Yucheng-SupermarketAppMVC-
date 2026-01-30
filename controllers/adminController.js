const refundService = require('../services/refundService');
const paymentOrchestrator = require('../services/paymentOrchestrator');
const RefundRequest = require('../models/RefundRequest');
const walletService = require('../services/walletService');

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

exports.paymentsPage = async (req, res) => {
    const connection = req.app.locals.connection;
    const rows = await queryAsync(
        connection,
        `SELECT p.id, p.order_id, p.user_id, p.provider, p.amount, p.currency, p.status, p.created_at,
                u.username,
                COALESCE(SUM(r.amount), 0) AS refunded_amount
         FROM payments p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN refunds r ON r.payment_id = p.id AND r.status = 'APPROVED'
         GROUP BY p.id
         ORDER BY p.created_at DESC`
    );

    const payments = rows.map((row) => {
        const refunded = parseFloat(row.refunded_amount || 0);
        const status = refunded >= row.amount ? 'REFUNDED' : (refunded > 0 ? 'PARTIAL_REFUNDED' : row.status);
        return { ...row, refunded_amount: refunded, refund_status: status };
    });

    res.render('adminPayments', {
        user: req.session.user,
        payments
    });
};

exports.listPayments = async (req, res) => {
    const connection = req.app.locals.connection;
    const rows = await queryAsync(connection, 'SELECT * FROM payments ORDER BY created_at DESC');
    res.json(rows);
};

exports.createRefund = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const { paymentId, amount, reason, method } = req.body;
        const refundId = await refundService.createRefund(connection, {
            paymentId: parseInt(paymentId),
            amount: parseFloat(amount),
            reason,
            method,
            adminId: req.session.user.id
        });
        res.json({ success: true, refundId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.refundPaymentFromDashboard = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const paymentId = parseInt(req.params.txnId, 10);
        if (!paymentId) return res.status(400).json({ error: 'Invalid payment id' });

        const payments = await queryAsync(connection, 'SELECT * FROM payments WHERE id = ?', [paymentId]);
        if (payments.length === 0) return res.status(404).json({ error: 'Payment not found' });
        const payment = payments[0];

        const refundedRows = await queryAsync(
            connection,
            'SELECT COALESCE(SUM(amount),0) AS refunded FROM refunds WHERE payment_id = ? AND status = "APPROVED"',
            [paymentId]
        );
        const refundedSoFar = parseFloat(refundedRows[0].refunded || 0);
        if (refundedSoFar >= payment.amount) {
            return res.status(400).json({ error: 'Payment already refunded' });
        }

        let amount = parseFloat(req.body.amount || 0);
        if (!amount || amount <= 0) {
            amount = parseFloat((payment.amount - refundedSoFar).toFixed(2));
        }

        const refundId = await refundService.createRefund(connection, {
            paymentId,
            amount,
            reason: req.body.reason || 'Admin refund',
            method: req.body.method || 'WALLET',
            adminId: req.session.user.id
        });

        return res.json({ success: true, refundId });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
};

exports.listDisputes = async (req, res) => {
    const connection = req.app.locals.connection;
    const rows = await queryAsync(connection, 'SELECT * FROM disputes ORDER BY created_at DESC');
    res.json(rows);
};

exports.resolveDispute = async (req, res) => {
    const connection = req.app.locals.connection;
    const id = req.params.id;
    const { resolution } = req.body;

    await queryAsync(
        connection,
        'UPDATE disputes SET status = "RESOLVED", resolution = ?, resolved_by = ? WHERE id = ?',
        [resolution, req.session.user.id, id]
    );
    res.json({ success: true });
};

exports.listRisk = async (req, res) => {
    const connection = req.app.locals.connection;
    const rows = await queryAsync(connection, 'SELECT * FROM risk_reviews ORDER BY created_at DESC');
    res.json(rows);
};

exports.decideRisk = async (req, res) => {
    const connection = req.app.locals.connection;
    const orderId = req.params.orderId;
    const { decision } = req.body;

    await queryAsync(
        connection,
        'UPDATE risk_reviews SET decision = ?, reviewed_by = ? WHERE order_id = ?',
        [decision, req.session.user.id, orderId]
    );

    if (decision === 'RELEASE') {
        await paymentOrchestrator.releaseEscrow(connection, orderId);
    }

    res.json({ success: true });
};

exports.revenue = async (req, res) => {
    const connection = req.app.locals.connection;
    const rows = await queryAsync(
        connection,
        `SELECT SUM(total_price) as revenue, COUNT(*) as orders
         FROM orders WHERE status = 'PAID'`
    );
    res.json(rows[0]);
};

exports.ordersPage = async (req, res) => {
    const connection = req.app.locals.connection;
    const orders = await queryAsync(
        connection,
        `SELECT o.order_id, o.total_price, o.status, o.created_at, u.username,
                COALESCE(oi.item_count, 0) AS item_count,
                p.status AS payment_status,
                rr.status AS refund_status
         FROM orders o
         JOIN users u ON o.user_id = u.id
         LEFT JOIN (
             SELECT order_id, COUNT(*) AS item_count
             FROM order_items
             GROUP BY order_id
         ) oi ON oi.order_id = o.order_id
         LEFT JOIN (
             SELECT p1.order_id, p1.status
             FROM payments p1
             JOIN (
                 SELECT order_id, MAX(id) AS max_id
                 FROM payments
                 GROUP BY order_id
             ) p2 ON p1.order_id = p2.order_id AND p1.id = p2.max_id
         ) p ON p.order_id = o.order_id
         LEFT JOIN (
             SELECT rr1.order_id, rr1.status
             FROM refund_requests rr1
             JOIN (
                 SELECT order_id, MAX(id) AS max_id
                 FROM refund_requests
                 GROUP BY order_id
             ) rr2 ON rr1.order_id = rr2.order_id AND rr1.id = rr2.max_id
         ) rr ON rr.order_id = o.order_id
         ORDER BY o.order_id DESC`
    );

    res.render('adminOrders', {
        user: req.session.user,
        orders
    });
};

exports.refundRequestsPage = async (req, res) => {
    try {
        const requests = await RefundRequest.getPendingRequests();
        res.render('adminRefundRequests', {
            user: req.session.user,
            requests,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    } catch (err) {
        req.flash('error', err.message);
        res.render('adminRefundRequests', {
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

        const newApprovedTotal = totalApproved + parseFloat(refund.requested_amount);
        const paymentStatus = newApprovedTotal >= totalPaid ? 'REFUNDED' : 'PARTIAL_REFUNDED';
        try {
            await queryAsync(
                connection,
                'UPDATE payments SET status = ? WHERE order_id = ? AND status = "SUCCEEDED"',
                [paymentStatus, refund.order_id]
            );
        } catch (err) {
            console.warn('Payment status update skipped:', err.message);
        }
        try {
            await queryAsync(
                connection,
                'UPDATE orders SET status = ? WHERE order_id = ?',
                [paymentStatus, refund.order_id]
            );
        } catch (err) {
            console.warn('Order status update skipped:', err.message);
        }

        req.flash('success', 'Refund approved and credited to wallet.');
        return res.redirect('/admin/refunds/requests');
    } catch (err) {
        req.flash('error', err.message);
        return res.redirect('/admin/refunds/requests');
    }
};
