const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

const PLATFORM_USER_ID = 0;

async function ensureAccount(connection, { userId, type, initialBalance }) {
    const rows = await queryAsync(
        connection,
        'SELECT id, balance FROM accounts WHERE user_id = ? AND type = ? LIMIT 1',
        [userId, type]
    );
    if (rows.length > 0) return rows[0];

    const result = await queryAsync(
        connection,
        'INSERT INTO accounts (user_id, type, balance) VALUES (?, ?, ?)',
        [userId, type, initialBalance]
    );
    return { id: result.insertId, balance: initialBalance };
}

async function recordWalletTransferTx(connection, { userId, amount, direction, referenceType, referenceId, notes }) {
    const walletUserId = userId;
    const walletType = 'WALLET';
    const platformType = 'PLATFORM';

    const walletAccount = await ensureAccount(connection, {
        userId: walletUserId,
        type: walletType,
        initialBalance: 0
    });
    const platformAccount = await ensureAccount(connection, {
        userId: PLATFORM_USER_ID,
        type: platformType,
        initialBalance: 0
    });

    const debitAccountId = direction === 'DEBIT' ? walletAccount.id : platformAccount.id;
    const creditAccountId = direction === 'DEBIT' ? platformAccount.id : walletAccount.id;

    const debitDelta = direction === 'DEBIT' ? -amount : amount;
    const creditDelta = direction === 'DEBIT' ? amount : -amount;

    await queryAsync(
        connection,
        'UPDATE accounts SET balance = balance + ? WHERE id = ?',
        [debitDelta, debitAccountId]
    );
    await queryAsync(
        connection,
        'UPDATE accounts SET balance = balance + ? WHERE id = ?',
        [creditDelta, creditAccountId]
    );

    await queryAsync(
        connection,
        `INSERT INTO ledger_entries
         (debit_account_id, credit_account_id, amount, reference_id, reference_type, notes)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
            debitAccountId,
            creditAccountId,
            amount,
            referenceId || null,
            referenceType || null,
            notes || null
        ]
    );
}

async function ensureAccountBalances(connection, userId, walletBalance) {
    const wallet = await ensureAccount(connection, {
        userId,
        type: 'WALLET',
        initialBalance: walletBalance
    });
    await ensureAccount(connection, {
        userId: PLATFORM_USER_ID,
        type: 'PLATFORM',
        initialBalance: 0
    });
    return wallet;
}

module.exports = { recordWalletTransferTx, ensureAccountBalances, PLATFORM_USER_ID };
