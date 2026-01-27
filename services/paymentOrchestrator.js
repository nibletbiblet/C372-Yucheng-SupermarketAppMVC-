const riskService = require('./riskService');
const walletService = require('./walletService');

const providers = {
    PAYPAL: require('./providers/paypalProvider'),
    NETS: require('./providers/netsProvider'),
    WALLET: require('./providers/walletProvider'),
    STRIPE: require('./providers/stripeProvider'),
    STRIPE_PAYNOW: require('./providers/stripeProvider'),
    STRIPE_GPAY: require('./providers/stripeProvider')
};

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

async function getOrderTotal(connection, orderId) {
    const rows = await queryAsync(
        connection,
        'SELECT total_price FROM orders WHERE order_id = ?',
        [orderId]
    );
    if (rows.length === 0) throw new Error('Order not found');
    const totalPrice = parseFloat(rows[0].total_price || 0);
    if (totalPrice > 0) return totalPrice;

    const sumRows = await queryAsync(
        connection,
        'SELECT COALESCE(SUM(subtotal),0) AS total FROM order_items WHERE order_id = ?',
        [orderId]
    );
    return parseFloat(sumRows[0].total || 0);
}

async function recalcAndFinalize(connection, orderId) {
    const totalRows = await queryAsync(
        connection,
        'SELECT total_price, escrow_required FROM orders WHERE order_id = ?',
        [orderId]
    );
    if (totalRows.length === 0) throw new Error('Order not found');
    const orderTotal = parseFloat(totalRows[0].total_price || 0);
    const escrowRequired = totalRows[0].escrow_required === 1;

    const paidRows = await queryAsync(
        connection,
        `SELECT COALESCE(SUM(amount),0) AS totalPaid
         FROM payments
         WHERE order_id = ? AND status = 'SUCCEEDED'`,
        [orderId]
    );
    const totalPaid = parseFloat(paidRows[0].totalPaid || 0);

    if (totalPaid >= orderTotal && orderTotal > 0) {
        const newStatus = escrowRequired ? 'HELD' : 'PAID';
        await queryAsync(
            connection,
            'UPDATE orders SET status = ? WHERE order_id = ?',
            [newStatus, orderId]
        );
        if (!escrowRequired) {
            await walletService.applyCashbackIfEligible(connection, orderId);
        }
    }
}

async function createPayment({ connection, orderId, userId, provider, useWalletAmount, escrow }) {
    const orderTotal = await getOrderTotal(connection, orderId);

    const risk = await riskService.evaluateRisk(connection, userId, orderId, orderTotal);
    const escrowRequired = escrow === true || risk.decision === 'HELD';

    await queryAsync(
        connection,
        'UPDATE orders SET escrow_required = ? WHERE order_id = ?',
        [escrowRequired ? 1 : 0, orderId]
    );

    const walletAmount = Math.max(0, Math.min(useWalletAmount || 0, orderTotal));
    let remaining = orderTotal;

    if (walletAmount > 0) {
        await walletService.debit(
            connection,
            userId,
            walletAmount,
            { orderId, note: 'Split payment wallet portion' }
        );

        await queryAsync(
            connection,
            `INSERT INTO payments
             (order_id, user_id, provider, amount, currency, status, escrow_status, metadata_json)
             VALUES (?, ?, 'WALLET', ?, 'SGD', 'SUCCEEDED', ?, ?)`,
            [
                orderId,
                userId,
                walletAmount,
                escrowRequired ? 'HELD' : 'NONE',
                JSON.stringify({ split: true })
            ]
        );

        remaining = parseFloat((orderTotal - walletAmount).toFixed(2));
    }

    if (remaining <= 0) {
        await recalcAndFinalize(connection, orderId);
        return {
            orderId,
            provider: 'WALLET',
            remaining: 0,
            escrowRequired,
            risk
        };
    }

    if (!providers[provider]) {
        throw new Error('Unsupported provider');
    }

    const providerOptions = {};
    if (provider === 'STRIPE_PAYNOW') {
        providerOptions.methodTypes = ['paynow'];
    }
    if (provider === 'STRIPE_GPAY') {
        providerOptions.methodTypes = ['card'];
    }

    const providerResult = await providers[provider].createPayment({
        amount: remaining,
        currency: 'SGD',
        orderId,
        ...providerOptions
    });

    await queryAsync(
        connection,
        `INSERT INTO payments
         (order_id, user_id, provider, provider_ref, amount, currency, status, escrow_status, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'SGD', 'PENDING', 'NONE', ?)`,
        [
            orderId,
            userId,
            provider,
            providerResult.providerRef || null,
            remaining,
            JSON.stringify({
                escrowRequired,
                riskScore: risk.risk_score,
                flags: risk.flags
            })
        ]
    );

    return {
        orderId,
        provider,
        remaining,
        escrowRequired,
        risk,
        providerData: providerResult
    };
}

async function markExternalSuccess(connection, { provider, providerRef }) {
    const rows = await queryAsync(
        connection,
        'SELECT id, order_id, metadata_json FROM payments WHERE provider = ? AND provider_ref = ?',
        [provider, providerRef]
    );
    if (rows.length === 0) throw new Error('Payment not found');

    const payment = rows[0];
    let metadata = {};
    if (payment.metadata_json) {
        try {
            metadata = JSON.parse(payment.metadata_json);
        } catch (err) {
            metadata = {};
        }
    }
    const escrowRequired = !!metadata.escrowRequired;

    await queryAsync(
        connection,
        'UPDATE payments SET status = ?, escrow_status = ? WHERE id = ?',
        ['SUCCEEDED', escrowRequired ? 'HELD' : 'NONE', payment.id]
    );

    await recalcAndFinalize(connection, payment.order_id);
    return { orderId: payment.order_id };
}

async function releaseEscrow(connection, orderId) {
    await queryAsync(
        connection,
        "UPDATE payments SET escrow_status = 'RELEASED' WHERE order_id = ? AND escrow_status = 'HELD'",
        [orderId]
    );
    await queryAsync(
        connection,
        "UPDATE orders SET status = 'PAID' WHERE order_id = ?",
        [orderId]
    );
    await walletService.applyCashbackIfEligible(connection, orderId);
}

module.exports = {
    createPayment,
    markExternalSuccess,
    recalcAndFinalize,
    releaseEscrow
};
