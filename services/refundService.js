const walletService = require('./walletService');
const paypalProvider = require('./providers/paypalProvider');

const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

async function createRefund(connection, { paymentId, amount, reason, method, adminId }) {
    const payments = await queryAsync(
        connection,
        'SELECT * FROM payments WHERE id = ?',
        [paymentId]
    );
    if (payments.length === 0) throw new Error('Payment not found');
    const payment = payments[0];

    const refunded = await queryAsync(
        connection,
        'SELECT COALESCE(SUM(amount),0) AS refunded FROM refunds WHERE payment_id = ? AND status = "APPROVED"',
        [paymentId]
    );
    const refundedSoFar = parseFloat(refunded[0].refunded || 0);
    if (refundedSoFar + amount > payment.amount) {
        throw new Error('Refund exceeds payment amount');
    }

    let refundMethod = method || 'WALLET';
    if (refundMethod === 'ORIGINAL' && payment.provider === 'PAYPAL') {
        const supported = await paypalProvider.refundPayment(payment.provider_ref, amount);
        if (!supported) {
            refundMethod = 'WALLET';
        }
    } else if (refundMethod === 'ORIGINAL' && payment.provider !== 'PAYPAL') {
        refundMethod = 'WALLET';
    }

    const refundResult = await queryAsync(
        connection,
        `INSERT INTO refunds (payment_id, amount, reason, method, status, approved_by)
         VALUES (?, ?, ?, ?, 'APPROVED', ?)`,
        [paymentId, amount, reason || null, refundMethod, adminId || null]
    );

    if (refundMethod === 'WALLET') {
        await walletService.credit(connection, payment.user_id, amount, {
            type: 'REFUND',
            orderId: payment.order_id,
            refType: 'PAYMENT',
            refId: payment.id
        });
    }

    const newStatus = (refundedSoFar + amount) >= payment.amount ? 'REFUNDED' : 'PARTIAL_REFUNDED';
    await queryAsync(
        connection,
        'UPDATE payments SET status = ? WHERE id = ?',
        [newStatus, paymentId]
    );

    return refundResult.insertId;
}

module.exports = { createRefund };
