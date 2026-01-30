const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

module.exports = async function idempotencyMiddleware(req, res, next) {
    try {
        const key = req.get('Idempotency-Key');
        if (!key) return next();

        const connection = req.app.locals.connection;
        if (!connection) return next();

        const rows = await queryAsync(
            connection,
            'SELECT response_json FROM idempotency_keys WHERE `key` = ? LIMIT 1',
            [key]
        );

        if (rows.length > 0) {
            try {
                const cached = JSON.parse(rows[0].response_json || '{}');
                return res.json(cached);
            } catch (err) {
                return res.json({ error: 'Idempotency cache corrupted' });
            }
        }

        res.locals.idempotencyKey = key;

        const originalJson = res.json.bind(res);
        res.json = async (body) => {
            try {
                if (res.locals.idempotencyKey && res.statusCode >= 200 && res.statusCode < 300) {
                    await queryAsync(
                        connection,
                        'INSERT IGNORE INTO idempotency_keys (`key`, response_json, created_at) VALUES (?, ?, NOW())',
                        [res.locals.idempotencyKey, JSON.stringify(body)]
                    );
                }
            } catch (err) {
                console.warn('Idempotency cache save failed:', err.message);
            }
            return originalJson(body);
        };

        return next();
    } catch (err) {
        console.warn('Idempotency middleware error:', err.message);
        return next();
    }
};
