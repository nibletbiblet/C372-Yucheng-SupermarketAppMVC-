const stripeProvider = require('../services/providers/stripeProvider');
const paymentOrchestrator = require('../services/paymentOrchestrator');
const checkoutController = require('./checkoutController');
const riskService = require('../services/riskService');

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

const beginTransactionAsync = (connection) =>
    new Promise((resolve, reject) => {
        connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

const commitAsync = (connection) =>
    new Promise((resolve, reject) => {
        connection.commit((err) => (err ? reject(err) : resolve()));
    });

const rollbackAsync = (connection) =>
    new Promise((resolve) => {
        connection.rollback(() => resolve());
    });

exports.listSavedMethods = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const rows = await queryAsync(
            connection,
            `SELECT id, type, last4, expiry, is_default
             FROM saved_payment_methods
             WHERE user_id = ?
             ORDER BY is_default DESC, id DESC`,
            [req.session.user.id]
        );
        res.json({ methods: rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.saveMethod = async (req, res) => {
    const connection = req.app.locals.connection;
    const { token, type, last4, expiry, isDefault } = req.body || {};
    if (!token || !type) {
        return res.status(400).json({ error: 'Missing token or type' });
    }

    await beginTransactionAsync(connection);
    try {
        if (isDefault) {
            await queryAsync(
                connection,
                'UPDATE saved_payment_methods SET is_default = 0 WHERE user_id = ?',
                [req.session.user.id]
            );
        }

        const result = await queryAsync(
            connection,
            `INSERT INTO saved_payment_methods
             (user_id, token, type, last4, expiry, is_default)
             VALUES (?, ?, ?, ?, ?, ?)` ,
            [
                req.session.user.id,
                token,
                String(type || '').toUpperCase(),
                last4 || null,
                expiry || null,
                isDefault ? 1 : 0
            ]
        );

        await commitAsync(connection);
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        await rollbackAsync(connection);
        res.status(400).json({ error: err.message });
    }
};

exports.chargeSavedMethod = async (req, res) => {
    const connection = req.app.locals.connection;
    const { savedMethodId, orderId } = req.body || {};

    if (!savedMethodId) {
        return res.status(400).json({ error: 'Missing saved method' });
    }

    try {
        const methods = await queryAsync(
            connection,
            'SELECT * FROM saved_payment_methods WHERE id = ? AND user_id = ?',
            [savedMethodId, req.session.user.id]
        );
        if (methods.length === 0) {
            return res.status(404).json({ error: 'Saved method not found' });
        }

        const method = methods[0];
        let targetOrderId = orderId;

        if (!targetOrderId) {
            const created = await checkoutController.createOrderFromCart(req);
            targetOrderId = created.orderId;
        }

        const orderRows = await queryAsync(
            connection,
            'SELECT total_price FROM orders WHERE order_id = ? AND user_id = ?',
            [targetOrderId, req.session.user.id]
        );
        if (orderRows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }

        const amount = parseFloat(orderRows[0].total_price || 0);
        if (amount <= 0) {
            return res.status(400).json({ error: 'Invalid order amount' });
        }

        const risk = await riskService.evaluateRisk(connection, req.session.user.id, targetOrderId, amount);
        const escrowRequired = risk.decision === 'HELD';
        await queryAsync(
            connection,
            'UPDATE orders SET escrow_required = ? WHERE order_id = ?',
            [escrowRequired ? 1 : 0, targetOrderId]
        );

        let providerRef = null;
        const type = String(method.type || '').toUpperCase();
        if (type === 'STRIPE') {
            const charge = await stripeProvider.chargeSavedPaymentMethod({
                amount,
                currency: 'SGD',
                orderId: targetOrderId,
                paymentMethodId: method.token
            });
            providerRef = charge.providerRef || null;
        } else {
            return res.status(400).json({ error: 'Saved method type not supported' });
        }

        await queryAsync(
            connection,
            `INSERT INTO payments
             (order_id, user_id, provider, provider_ref, amount, currency, status, escrow_status, metadata_json)
             VALUES (?, ?, ?, ?, ?, 'SGD', 'SUCCEEDED', ?, ?)` ,
            [
                targetOrderId,
                req.session.user.id,
                type,
                providerRef,
                amount,
                escrowRequired ? 'HELD' : 'NONE',
                JSON.stringify({ savedMethodId: method.id, riskScore: risk.risk_score, flags: risk.flags })
            ]
        );

        await paymentOrchestrator.recalcAndFinalize(connection, targetOrderId);

        return res.json({ success: true, orderId: targetOrderId });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
};
