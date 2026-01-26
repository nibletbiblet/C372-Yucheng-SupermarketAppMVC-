const axios = require("axios");

exports.generateQrCode = async (req, res) => {
    const { cartTotal } = req.body;
    try {
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

            res.render("netsQr", {
                total: cartTotal,
                title: "Scan to Pay",
                qrCodeUrl: `data:image/png;base64,${qrData.qr_code}`,
                txnRetrievalRef
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
