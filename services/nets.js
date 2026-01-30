const axios = require("axios");
const checkoutController = require('../controllers/checkoutController');

exports.generateQrCode = async (req, res) => {
    const { cartTotal } = req.body;
    try {
        const connection = req.app.locals.connection;
        const queryAsync = (sql, params) =>
            new Promise((resolve, reject) => {
                connection.query(sql, params, (err, results) => (err ? reject(err) : resolve(results)));
            });

        let orderId = req.session.lastOrderId || null;
        if (!orderId) {
            const created = await checkoutController.createOrderFromCart(req);
            orderId = created.orderId;
            req.session.lastOrderId = orderId;
        }

        const requestBody = {
            txn_id: "sandbox_nets|m|8ff8e5b6-d43e-4786-8ac5-7accf8c5bd9b",
            amt_in_dollars: cartTotal,
            notify_mobile: 0
        };

        const response = await axios.post(
            "https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request",
            requestBody,
            {
                headers: {
                    "api-key": process.env.API_KEY,
                    "project-id": process.env.PROJECT_ID
                }
            }
        );

        const qrData = response.data.result.data;

        if (qrData.response_code === "00" && qrData.txn_status === 1 && qrData.qr_code) {
            const txnRetrievalRef = qrData.txn_retrieval_ref;
            if (!req.session.netsOrderMap) {
                req.session.netsOrderMap = {};
            }
            req.session.netsOrderMap[txnRetrievalRef] = orderId;

            await queryAsync(
                `INSERT INTO payments
                 (order_id, user_id, provider, provider_ref, amount, currency, status, escrow_status, metadata_json)
                 VALUES (?, ?, 'NETS', ?, ?, 'SGD', 'PENDING', 'NONE', ?)`,
                [
                    orderId,
                    req.session.user.id,
                    txnRetrievalRef,
                    parseFloat(cartTotal || 0),
                    JSON.stringify({ qr: true })
                ]
            );

            res.render("netsQr", {
                total: cartTotal,
                title: "Scan to Pay",
                qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
                txnRetrievalRef,
                orderId
            });
            return;
        }

        res.render("netsQrFail", {
            title: "Error",
            responseCode: qrData.response_code || "N.A.",
            instructions: qrData.instruction || "",
            errorMsg: qrData.error_message || "Transaction failed. Please try again."
        });
    } catch (error) {
        console.error("Error in generateQrCode:", error.message);
        res.redirect("/nets-qr/fail");
    }
};
