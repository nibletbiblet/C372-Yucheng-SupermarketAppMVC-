const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

async function getBalance(connection, userId) {
    const rows = await queryAsync(connection, 'SELECT wallet_balance FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) throw new Error('User not found');
    return parseFloat(rows[0].wallet_balance || 0);
}

async function recordLedger(connection, { userId, type, amount, balanceAfter, orderId, paymentId, refType, refId, metadata }) {
    await queryAsync(
        connection,
        `INSERT INTO wallet_ledger
         (user_id, order_id, payment_id, type, amount, balance_after, ref_type, ref_id, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            userId,
            orderId || null,
            paymentId || null,
            type,
            amount,
            balanceAfter,
            refType || null,
            refId || null,
            metadata ? JSON.stringify(metadata) : null
        ]
    );
}

async function debit(connection, userId, amount, meta) {
    const balance = await getBalance(connection, userId);
    if (balance < amount) throw new Error('Insufficient wallet balance');

    await queryAsync(
        connection,
        'UPDATE users SET wallet_balance = wallet_balance - ? WHERE id = ?',
        [amount, userId]
    );

    const newBalance = balance - amount;
    await recordLedger(connection, {
        userId,
        type: 'PAYMENT',
        amount,
        balanceAfter: newBalance,
        orderId: meta && meta.orderId,
        refType: 'ORDER',
        refId: meta && meta.orderId,
        metadata: meta || {}
    });
    return newBalance;
}

async function credit(connection, userId, amount, meta) {
    const balance = await getBalance(connection, userId);
    await queryAsync(
        connection,
        'UPDATE users SET wallet_balance = wallet_balance + ? WHERE id = ?',
        [amount, userId]
    );
    const newBalance = balance + amount;
    await recordLedger(connection, {
        userId,
        type: meta && meta.type ? meta.type : 'REFUND',
        amount,
        balanceAfter: newBalance,
        orderId: meta && meta.orderId,
        refType: meta && meta.refType,
        refId: meta && meta.refId,
        metadata: meta || {}
    });
    return newBalance;
}

async function applyCashbackIfEligible(connection, orderId) {
    const cashbackRate = 0.02;

    const existing = await queryAsync(
        connection,
        `SELECT id FROM wallet_ledger WHERE order_id = ? AND type = 'CASHBACK'`,
        [orderId]
    );
    if (existing.length > 0) return;

    const orderRows = await queryAsync(
        connection,
        'SELECT user_id, total_price FROM orders WHERE order_id = ? AND status = "PAID"',
        [orderId]
    );
    if (orderRows.length === 0) return;

    const userId = orderRows[0].user_id;
    const total = parseFloat(orderRows[0].total_price || 0);
    const cashback = parseFloat((total * cashbackRate).toFixed(2));
    if (cashback <= 0) return;

    await credit(connection, userId, cashback, {
        type: 'CASHBACK',
        orderId,
        refType: 'ORDER',
        refId: orderId
    });
}

module.exports = { getBalance, debit, credit, applyCashbackIfEligible };
