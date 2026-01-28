const paymentOrchestrator = require('../services/paymentOrchestrator');
const walletService = require('../services/walletService');
const paypalProvider = require('../services/providers/paypalProvider');
const netsProvider = require('../services/providers/netsProvider');
const airwallexProvider = require('../services/providers/airwallexProvider');
const crypto = require('crypto');

const audit = (event, details = {}) => {
    const safe = {
        event,
        time: new Date().toISOString(),
        ...details
    };
    console.log('[AUDIT]', JSON.stringify(safe));
};

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
        const normalizedProvider = String(provider || '')
            .trim()
            .toUpperCase()
            .replace(/[^A-Z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        const providerAliases = {
            STRIPEPAYNOW: 'STRIPE_PAYNOW',
            STRIPE_PAYNOW: 'STRIPE_PAYNOW',
            STRIPE: 'STRIPE',
            PAYPAL: 'PAYPAL',
            NETS: 'NETS',
            WALLET: 'WALLET',
            AIRWALLEX: 'AIRWALLEX',
            AIRWALLEX_PAYNOW: 'AIRWALLEX'
        };
        const providerKey = providerAliases[normalizedProvider] || normalizedProvider;

        if (!providerKey) {
            audit('payment.create.missing_provider', { userId });
            return res.status(400).json({ error: 'Missing provider' });
        }

        audit('payment.create.request', {
            userId,
            orderId: orderId || null,
            providerRaw: provider || null,
            providerKey,
            useWalletAmount: useWalletAmount || 0,
            escrow: escrow === true
        });

        let targetOrderId = orderId;
        if (!targetOrderId) {
            const created = await createOrderFromCart(connection, req);
            targetOrderId = created.orderId;
            audit('payment.create.order_created', { userId, orderId: targetOrderId, total: created.total });
        } else {
            const rows = await queryAsync(
                connection,
                'SELECT order_id FROM orders WHERE order_id = ? AND user_id = ?',
                [targetOrderId, userId]
            );
            if (rows.length === 0) {
                audit('payment.create.invalid_order', { userId, orderId: targetOrderId });
                return res.status(403).json({ error: 'Invalid order' });
            }
        }

        const result = await paymentOrchestrator.createPayment({
            connection,
            orderId: targetOrderId,
            userId,
            provider: providerKey,
            useWalletAmount: parseFloat(useWalletAmount || 0),
            escrow: escrow === true
        });

        audit('payment.create.success', {
            userId,
            orderId: targetOrderId,
            provider: providerKey,
            providerRef: result.providerData && result.providerData.providerRef
        });

        return res.json({ success: true, ...result });
    } catch (err) {
        const errDetails = err.response && err.response.data ? err.response.data : null;
        audit('payment.create.error', { error: err.message, details: errDetails });
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

        audit('paypal.callback.received', { providerRef });
        const capture = await paypalProvider.capturePayment(providerRef);
        if (!capture || capture.status !== 'COMPLETED') {
            audit('paypal.callback.failed', { providerRef, status: capture && capture.status });
            return res.status(400).json({ error: 'PayPal capture failed' });
        }

        const connection = req.app.locals.connection;
        const result = await paymentOrchestrator.markExternalSuccess(connection, {
            provider: 'PAYPAL',
            providerRef
        });

        audit('paypal.callback.success', { providerRef, orderId: result.orderId });
        res.json({ success: true, orderId: result.orderId });
    } catch (err) {
        audit('paypal.callback.error', { error: err.message });
        res.status(400).json({ error: err.message });
    }
};

exports.netsCallback = async (req, res) => {
    try {
        const { txnRetrievalRef } = req.body;
        if (!txnRetrievalRef) return res.status(400).json({ error: 'Missing NETS reference' });

        audit('nets.callback.received', { providerRef: txnRetrievalRef });
        const connection = req.app.locals.connection;
        const result = await paymentOrchestrator.markExternalSuccess(connection, {
            provider: 'NETS',
            providerRef: txnRetrievalRef
        });

        audit('nets.callback.success', { providerRef: txnRetrievalRef, orderId: result.orderId });
        res.json({ success: true, orderId: result.orderId });
    } catch (err) {
        audit('nets.callback.error', { error: err.message });
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
            audit('stripe.callback.success', { providerRef: session_id, orderId: order_id });
        } catch (err) {
            console.error('Stripe callback update failed:', err.message);
            audit('stripe.callback.error', { error: err.message, providerRef: session_id, orderId: order_id });
        }

        return res.redirect('/checkout/success/' + order_id);
    } catch (err) {
        audit('stripe.callback.error', { error: err.message });
        return res.status(400).send(err.message);
    }
};

exports.netsQr = async (req, res) => {
    try {
        const { amount } = req.body;
        const parsedAmount = parseFloat(amount || 0);
        if (parsedAmount <= 0) return res.status(400).json({ error: 'Invalid amount' });

        audit('nets.qr.request', { amount: parsedAmount });
        const providerResult = await netsProvider.createPayment({ amount: parsedAmount });
        audit('nets.qr.success', { providerRef: providerResult.providerRef });
        res.json({
            success: true,
            qrCode: providerResult.qrCode,
            txnRetrievalRef: providerResult.providerRef
        });
    } catch (err) {
        audit('nets.qr.error', { error: err.message });
        res.status(400).json({ error: err.message });
    }
};

exports.airwallexCallback = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const { order_id: orderId, payment_intent_id: paymentIntentIdParam, id } = req.query;
        if (!orderId) return res.status(400).send('Missing order');

        let paymentIntentId = paymentIntentIdParam || id;
        if (!paymentIntentId) {
            const rows = await queryAsync(
                connection,
                "SELECT provider_ref FROM payments WHERE order_id = ? AND provider = 'AIRWALLEX' ORDER BY id DESC LIMIT 1",
                [orderId]
            );
            if (rows.length > 0) {
                paymentIntentId = rows[0].provider_ref;
            }
        }

        if (!paymentIntentId) {
            audit('airwallex.callback.missing_intent', { orderId });
            return res.redirect('/checkout/payment');
        }

        audit('airwallex.callback.received', { orderId, paymentIntentId });
        const intent = await airwallexProvider.getPaymentIntent(paymentIntentId);
        if (intent && intent.status === 'SUCCEEDED') {
            await paymentOrchestrator.markExternalSuccess(connection, {
                provider: 'AIRWALLEX',
                providerRef: paymentIntentId
            });
            audit('airwallex.callback.success', { orderId, paymentIntentId });
            return res.redirect('/checkout/success/' + orderId);
        }

        audit('airwallex.callback.pending', { orderId, paymentIntentId, status: intent && intent.status });
        return res.redirect('/checkout/payment');
    } catch (err) {
        audit('airwallex.callback.error', { error: err.message });
        return res.status(400).send(err.message);
    }
};

exports.airwallexStatus = async (req, res) => {
    try {
        const connection = req.app.locals.connection;
        const paymentIntentId = req.params.paymentIntentId;
        if (!paymentIntentId) return res.status(400).json({ error: 'Missing payment intent' });

        audit('airwallex.status.request', { paymentIntentId });
        const intent = await airwallexProvider.getPaymentIntent(paymentIntentId);
        if (intent && intent.status === 'SUCCEEDED') {
            await paymentOrchestrator.markExternalSuccess(connection, {
                provider: 'AIRWALLEX',
                providerRef: paymentIntentId
            });
            audit('airwallex.status.success', { paymentIntentId });
        }

        res.json({ status: intent.status || 'UNKNOWN', intentId: paymentIntentId });
    } catch (err) {
        audit('airwallex.status.error', { error: err.message });
        res.status(400).json({ error: err.message });
    }
};

exports.airwallexWebhook = async (req, res) => {
    try {
        const secret = process.env.AIRWALLEX_WEBHOOK_SECRET;
        const signature = req.headers['x-signature'];
        const timestamp = req.headers['x-timestamp'];
        const rawBody = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));

        if (secret && signature && timestamp) {
            const payloadToSign = `${timestamp}${rawBody.toString('utf8')}`;
            const expectedBase64 = crypto
                .createHmac('sha256', secret)
                .update(payloadToSign)
                .digest('base64');
            const expectedHex = crypto
                .createHmac('sha256', secret)
                .update(payloadToSign)
                .digest('hex');

            if (signature !== expectedBase64 && signature !== expectedHex) {
                audit('airwallex.webhook.invalid_signature', { signaturePresent: true });
                return res.status(400).send('Invalid signature');
            }
        }

        const event = req.body || {};
        const eventName = event.name || event.type;
        const paymentIntentId =
            event.data?.id ||
            event.data?.object?.id ||
            event.data?.payment_intent_id;

        audit('airwallex.webhook.received', { eventName, paymentIntentId });
        if (eventName === 'payment_intent.succeeded' && paymentIntentId) {
            const connection = req.app.locals.connection;
            await paymentOrchestrator.markExternalSuccess(connection, {
                provider: 'AIRWALLEX',
                providerRef: paymentIntentId
            });
            audit('airwallex.webhook.success', { paymentIntentId });
        }

        return res.json({ received: true });
    } catch (err) {
        audit('airwallex.webhook.error', { error: err.message });
        return res.status(400).json({ error: err.message });
    }
};
