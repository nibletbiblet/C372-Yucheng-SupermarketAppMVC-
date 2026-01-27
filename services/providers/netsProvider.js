const axios = require('axios');

async function createPayment({ amount }) {
    const requestBody = {
        txn_id: `sandbox_nets|m|${Date.now()}`,
        amt_in_dollars: amount.toFixed(2),
        notify_mobile: 0
    };

    const response = await axios.post(
        'https://sandbox.nets.openapipaas.com/api/v1/common/payments/nets-qr/request',
        requestBody,
        {
            headers: {
                'api-key': process.env.API_KEY,
                'project-id': process.env.PROJECT_ID
            }
        }
    );

    const data = response.data.result.data;
    if (data.response_code !== '00' || data.txn_status !== 1) {
        throw new Error('NETS QR generation failed');
    }

    return {
        providerRef: data.txn_retrieval_ref,
        qrCode: data.qr_code
    };
}

module.exports = { createPayment };
