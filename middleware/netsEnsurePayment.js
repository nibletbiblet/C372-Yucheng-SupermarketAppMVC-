const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

module.exports = async function netsEnsurePayment(req, res, next) {
    try {
        const txnRetrievalRef = req.body && req.body.txnRetrievalRef;
        if (!txnRetrievalRef) return next();

        const connection = req.app.locals.connection;
        if (!connection) return next();

        const existing = await queryAsync(
            connection,
            'SELECT id FROM payments WHERE provider = ? AND provider_ref = ? LIMIT 1',
            ['NETS', txnRetrievalRef]
        );
        if (existing.length > 0) return next();

        let orderId =
            (req.session.netsOrderMap && req.session.netsOrderMap[txnRetrievalRef]) ||
            req.session.lastOrderId ||
            null;

        if (!orderId && req.session.user && req.session.user.id) {
            const rows = await queryAsync(
                connection,
                'SELECT order_id FROM orders WHERE user_id = ? ORDER BY order_id DESC LIMIT 1',
                [req.session.user.id]
            );
            if (rows.length > 0) {
                orderId = rows[0].order_id;
            }
        }

        if (!orderId) return next();

        const orderRows = await queryAsync(
            connection,
            'SELECT total_price FROM orders WHERE order_id = ?',
            [orderId]
        );
        const amount = orderRows.length > 0 ? parseFloat(orderRows[0].total_price || 0) : 0;

        await queryAsync(
            connection,
            `INSERT INTO payments
             (order_id, user_id, provider, provider_ref, amount, currency, status, escrow_status, metadata_json)
             VALUES (?, ?, 'NETS', ?, ?, 'SGD', 'PENDING', 'NONE', ?)`,
            [
                orderId,
                req.session.user.id,
                txnRetrievalRef,
                amount,
                JSON.stringify({ recovered: true })
            ]
        );
    } catch (err) {
        // Silent fail to avoid blocking callback
    }
    return next();
};
