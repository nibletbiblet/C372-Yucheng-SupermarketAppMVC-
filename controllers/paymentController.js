const paymentOrchestrator = require('../services/paymentOrchestrator');
const walletService = require('../services/walletService');
const paypalProvider = require('../services/providers/paypalProvider');
const netsProvider = require('../services/providers/netsProvider');

const beginTransactionAsync = (connection) =>
    new Promise((resolve, reject) => {
        connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

const commitAsync = (connection) =>
    new Promise((resolve, reject) => {
        connection.commit((err) => (err ? reject(err) : resolve()));
    });

const rollbackAsync = (connection) =>
    new Promise((resolve) => {
        connection.rollback(() => resolve());
    });

async function createOrderFromCart(connection, req) {
    const cart = req.session.cart || [];
    if (cart.length === 0) throw new Error('Your cart is empty');

    const userId = req.session.user.id;
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    await beginTransactionAsync(connection);
    try {
        const orderSql = 'INSERT INTO orders (user_id, total_price, status) VALUES (?, ?, ?)';
        const orderResult = await queryAsync(connection, orderSql, [userId, total, 'PENDING']);
        const orderId = orderResult.insertId;

        for (const item of cart) {
            const rows = await queryAsync(connection, 'SELECT quantity FROM products WHERE id = ?', [item.id]);
            if (!rows || rows.length === 0) throw new Error('Product not found: ' + item.name);

            const availableStock = rows[0].quantity;
            if (availableStock < item.quantity) {
                throw new Error(`Not enough stock for ${item.name}. Only ${availableStock} available.`);
            }

            const subtotal = item.price * item.quantity;
            await queryAsync(
                connection,
                'INSERT INTO order_items (order_id, product_id, quantity, price, subtotal) VALUES (?, ?, ?, ?, ?)',
                [orderId, item.id, item.quantity, item.price, subtotal]
            );

            await queryAsync(
                connection,
                'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                [item.quantity, item.id]
            );
        }

        await commitAsync(connection);
        req.session.cart = [];
        return { orderId, total };
    } catch (err) {
        await rollbackAsync(connection);
        throw err;
    }
}

exports.createPayment = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const userId = req.session.user.id;
        const { orderId, provider, useWalletAmount, escrow } = req.body;

        let targetOrderId = orderId;
        if (!targetOrderId) {
            const created = await createOrderFromCart(connection, req);
            targetOrderId = created.orderId;
        } else {
            const rows = await queryAsync(
                connection,
                'SELECT order_id FROM orders WHERE order_id = ? AND user_id = ?',
                [targetOrderId, userId]
            );
            if (rows.length === 0) return res.status(403).json({ error: 'Invalid order' });
        }

        const result = await paymentOrchestrator.createPayment({
            connection,
            orderId: targetOrderId,
            userId,
            provider,
            useWalletAmount: parseFloat(useWalletAmount || 0),
            escrow: escrow === true
        });

        return res.json({ success: true, ...result });
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }
};

exports.getWalletBalance = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const balance = await walletService.getBalance(connection, req.session.user.id);
        res.json({ balance });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.walletTopup = async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount || 0);
        if (amount <= 0) return res.status(400).json({ error: 'Invalid amount' });

        const connection = req.app.locals.connection;
        const newBalance = await walletService.credit(connection, req.session.user.id, amount, {
            type: 'TOPUP',
            refType: 'TOPUP',
            refId: 'SIMULATED'
        });

        res.json({ success: true, balance: newBalance });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.bankSubmit = async (req, res) => {
    try {
        const { providerRef } = req.body;
        if (!providerRef) return res.status(400).json({ error: 'Missing bank reference' });

        const connection = req.app.locals.connection;
        const result = await paymentOrchestrator.markExternalSuccess(connection, {
            provider: 'BANK',
            providerRef
        });

        res.json({ success: true, orderId: result.orderId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.paypalCallback = async (req, res) => {
    try {
        const { providerRef } = req.body;
        if (!providerRef) return res.status(400).json({ error: 'Missing PayPal order ID' });

        const capture = await paypalProvider.capturePayment(providerRef);
        if (!capture || capture.status !== 'COMPLETED') {
            return res.status(400).json({ error: 'PayPal capture failed' });
        }

        const connection = req.app.locals.connection;
        const result = await paymentOrchestrator.markExternalSuccess(connection, {
            provider: 'PAYPAL',
            providerRef
        });

        res.json({ success: true, orderId: result.orderId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.netsCallback = async (req, res) => {
    try {
        const { txnRetrievalRef } = req.body;
        if (!txnRetrievalRef) return res.status(400).json({ error: 'Missing NETS reference' });

        const connection = req.app.locals.connection;
        const result = await paymentOrchestrator.markExternalSuccess(connection, {
            provider: 'NETS',
            providerRef: txnRetrievalRef
        });

        res.json({ success: true, orderId: result.orderId });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

exports.stripeCallback = async (req, res) => {
    try {
        const { session_id, order_id } = req.query;
        if (!session_id || !order_id) {
            return res.status(400).send('Missing Stripe session');
        }

        const connection = req.app.locals.connection;
        try {
            await paymentOrchestrator.markExternalSuccess(connection, {
                provider: 'STRIPE',
                providerRef: session_id
            });
        } catch (err) {
            console.error('Stripe callback update failed:', err.message);
        }

        return res.redirect('/checkout/success/' + order_id);
    } catch (err) {
        return res.status(400).send(err.message);
    }
};

exports.netsQr = async (req, res) => {
    try {
        const { amount } = req.body;
        const parsedAmount = parseFloat(amount || 0);
        if (parsedAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

        const providerResult = await netsProvider.createPayment({ amount: parsedAmount });
        res.json({
            success: true,
            qrCode: providerResult.qrCode,
            txnRetrievalRef: providerResult.providerRef
        });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};
