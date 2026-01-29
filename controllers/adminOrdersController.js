const queryAsync = (connection, sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

exports.ordersPage = async (req, res) => {
    const connection = req.app.locals.connection;
    const orders = await queryAsync(
        connection,
        `SELECT o.order_id, o.total_price, o.status, o.created_at, u.username,
                p.status AS payment_status,
                rr.status AS refund_status
         FROM orders o
         JOIN users u ON o.user_id = u.id
         LEFT JOIN (
             SELECT p1.order_id, p1.status
             FROM payments p1
             JOIN (
                 SELECT order_id, MAX(id) AS max_id
                 FROM payments
                 GROUP BY order_id
             ) p2 ON p1.order_id = p2.order_id AND p1.id = p2.max_id
         ) p ON p.order_id = o.order_id
         LEFT JOIN (
             SELECT rr1.order_id, rr1.status
             FROM refund_requests rr1
             JOIN (
                 SELECT order_id, MAX(id) AS max_id
                 FROM refund_requests
                 GROUP BY order_id
             ) rr2 ON rr1.order_id = rr2.order_id AND rr1.id = rr2.max_id
         ) rr ON rr.order_id = o.order_id
         ORDER BY o.order_id DESC`
    );

    res.render('adminOrders_new', {
        user: req.session.user,
        orders
    });
};
