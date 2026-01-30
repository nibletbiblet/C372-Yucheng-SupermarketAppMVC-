const ledgerService = require('./ledgerService');

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

async function getBalance(connection, userId) {
    const rows = await queryAsync(connection, 'SELECT wallet_balance FROM users WHERE id = ?', [userId]);
    if (rows.length === 0) throw new Error('User not found');
    return parseFloat(rows[0].wallet_balance || 0);
}

async function getBalanceForUpdate(connection, userId) {
    const rows = await queryAsync(
        connection,
        'SELECT wallet_balance FROM users WHERE id = ? FOR UPDATE',
        [userId]
    );
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
    const useExistingTransaction = meta && meta.useExistingTransaction === true;
    if (!useExistingTransaction) {
        await beginTransactionAsync(connection);
    }

    try {
        const balance = await getBalanceForUpdate(connection, userId);
        if (balance < amount) throw new Error('Insufficient wallet balance');

        await ledgerService.ensureAccountBalances(connection, userId, balance);

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
            paymentId: meta && meta.paymentId,
            refType: meta && meta.refType ? meta.refType : 'ORDER',
            refId: meta && (meta.refId || meta.orderId),
            metadata: meta || {}
        });

        await ledgerService.recordWalletTransferTx(connection, {
            userId,
            amount,
            direction: 'DEBIT',
            referenceType: meta && meta.refType ? meta.refType : 'ORDER',
            referenceId: meta && (meta.refId || meta.orderId),
            notes: meta && meta.note
        });

        if (!useExistingTransaction) {
            await commitAsync(connection);
        }
        return newBalance;
    } catch (err) {
        if (!useExistingTransaction) {
            await rollbackAsync(connection);
        }
        throw err;
    }
}

async function credit(connection, userId, amount, meta) {
    const useExistingTransaction = meta && meta.useExistingTransaction === true;
    if (!useExistingTransaction) {
        await beginTransactionAsync(connection);
    }

    try {
        const balance = await getBalanceForUpdate(connection, userId);

        await ledgerService.ensureAccountBalances(connection, userId, balance);

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
            paymentId: meta && meta.paymentId,
            refType: meta && meta.refType,
            refId: meta && meta.refId,
            metadata: meta || {}
        });

        await ledgerService.recordWalletTransferTx(connection, {
            userId,
            amount,
            direction: 'CREDIT',
            referenceType: meta && meta.refType,
            referenceId: meta && meta.refId,
            notes: meta && meta.note
        });

        if (!useExistingTransaction) {
            await commitAsync(connection);
        }
        return newBalance;
    } catch (err) {
        if (!useExistingTransaction) {
            await rollbackAsync(connection);
        }
        throw err;
    }
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
