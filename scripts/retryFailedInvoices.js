const mysql = require('mysql2');
require('dotenv').config();

const stripeProvider = require('../services/providers/stripeProvider');
const walletService = require('../services/walletService');

const connection = mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'c372_supermarketdb'
});

const queryAsync = (sql, params) =>
    new Promise((resolve, reject) => {
        connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
    });

const beginTransactionAsync = () =>
    new Promise((resolve, reject) => {
        connection.beginTransaction((err) => (err ? reject(err) : resolve()));
    });

const commitAsync = () =>
    new Promise((resolve, reject) => {
        connection.commit((err) => (err ? reject(err) : resolve()));
    });

const rollbackAsync = () =>
    new Promise((resolve) => {
        connection.rollback(() => resolve());
    });

async function processInvoice(invoice) {
    const now = new Date();
    const nextRetry = new Date(now.getTime() + 60 * 60 * 1000);

    try {
        await beginTransactionAsync();

        const rows = await queryAsync(
            'SELECT * FROM invoices WHERE id = ? FOR UPDATE',
            [invoice.id]
        );
        if (rows.length === 0) {
            await rollbackAsync();
            return;
        }

        const current = rows[0];
        if (current.status !== 'FAILED' || current.retry_count >= 3) {
            await rollbackAsync();
            return;
        }

        const methods = await queryAsync(
            'SELECT * FROM saved_payment_methods WHERE user_id = ? ORDER BY is_default DESC, id DESC LIMIT 1',
            [current.user_id]
        );

        let paid = false;
        if (methods.length > 0) {
            const method = methods[0];
            if (String(method.type).toUpperCase() === 'STRIPE') {
                await stripeProvider.chargeSavedPaymentMethod({
                    amount: parseFloat(current.amount),
                    currency: 'SGD',
                    orderId: current.id,
                    paymentMethodId: method.token
                });
                paid = true;
            }
        }

        if (!paid) {
            await walletService.debit(connection, current.user_id, parseFloat(current.amount), {
                useExistingTransaction: true,
                refType: 'INVOICE',
                refId: current.id,
                note: 'Invoice retry wallet charge'
            });
            paid = true;
        }

        if (paid) {
            await queryAsync(
                'UPDATE invoices SET status = "PAID", retry_count = retry_count + 1, next_retry_at = NULL WHERE id = ?',
                [current.id]
            );
        }

        await commitAsync();
    } catch (err) {
        await rollbackAsync();
        await queryAsync(
            'UPDATE invoices SET retry_count = retry_count + 1, next_retry_at = ? WHERE id = ?',
            [nextRetry, invoice.id]
        );
        console.error('Invoice retry failed:', invoice.id, err.message);
    }
}

async function run() {
    try {
        const invoices = await queryAsync(
            `SELECT id, user_id, amount, status, retry_count, next_retry_at
             FROM invoices
             WHERE status = 'FAILED' AND (next_retry_at IS NULL OR next_retry_at < NOW()) AND retry_count < 3
             ORDER BY next_retry_at ASC, id ASC`
        );

        for (const invoice of invoices) {
            await processInvoice(invoice);
        }
    } catch (err) {
        console.error('Retry job failed:', err.message);
    } finally {
        connection.end();
    }
}

run();
