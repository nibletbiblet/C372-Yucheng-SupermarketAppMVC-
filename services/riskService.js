const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

async function evaluateRisk(connection, userId, orderId, orderTotal) {
    let riskScore = 0;
    const flags = [];

    if (orderTotal > 200) {
        riskScore += 40;
        flags.push('HIGH_VALUE_ORDER');
    }

    const createdAtColumn = await queryAsync(connection, "SHOW COLUMNS FROM users LIKE 'created_at'");
    if (createdAtColumn.length === 0) {
        riskScore += 30;
        flags.push('NEW_USER_UNKNOWN');
    } else {
        const userRows = await queryAsync(connection, 'SELECT created_at FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0 || !userRows[0].created_at) {
            riskScore += 30;
            flags.push('NEW_USER_UNKNOWN');
        } else {
            const createdAt = new Date(userRows[0].created_at);
            const diffDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
            if (diffDays < 7) {
                riskScore += 30;
                flags.push('NEW_USER');
            }
        }
    }

    const failedRows = await queryAsync(
        connection,
        `SELECT COUNT(*) AS failedCount
         FROM payments
         WHERE user_id = ? AND status = 'FAILED' AND created_at >= (NOW() - INTERVAL 1 DAY)`,
        [userId]
    );
    if (failedRows[0].failedCount > 2) {
        riskScore += 20;
        flags.push('RECENT_FAILED_PAYMENTS');
    }

    const decision = riskScore >= 60 ? 'HELD' : 'AUTO_APPROVE';

    await queryAsync(
        connection,
        `INSERT INTO risk_reviews (order_id, risk_score, flags_json, decision)
         VALUES (?, ?, ?, ?)`,
        [orderId, riskScore, JSON.stringify(flags), decision]
    );

    return { risk_score: riskScore, flags, decision };
}

module.exports = { evaluateRisk };
