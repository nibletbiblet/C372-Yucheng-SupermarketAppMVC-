const refundService = require('../services/refundService');
const paymentOrchestrator = require('../services/paymentOrchestrator');

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

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
