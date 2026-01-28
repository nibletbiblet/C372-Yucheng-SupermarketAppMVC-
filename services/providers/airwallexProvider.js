const axios = require('axios');
const crypto = require('crypto');

let cachedToken = null;
let tokenExpiresAt = 0;

const getBaseUrl = () => process.env.AIRWALLEX_API_BASE || 'https://api-demo.airwallex.com';

const buildRequestId = (prefix) => {
    if (crypto.randomUUID) {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};

async function getAccessToken() {
    const now = Date.now();
    if (cachedToken && tokenExpiresAt - 5000 > now) {
        return cachedToken;
    }

    const clientId = process.env.AIRWALLEX_CLIENT_ID;
    const apiKey = process.env.AIRWALLEX_API_KEY;
    if (!clientId || !apiKey) {
        throw new Error('Airwallex is not configured');
    }

    let response;
    try {
        response = await axios.post(
            `${getBaseUrl()}/api/v1/authentication/login`,
            {},
            {
                headers: {
                    'x-client-id': clientId,
                    'x-api-key': apiKey
                }
            }
        );
    } catch (err) {
        const details = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Airwallex auth failed: ${details}`);
    }

    const data = response.data || {};
    cachedToken = data.token || data.access_token;

    if (!cachedToken) {
        throw new Error('Airwallex token missing');
    }

    if (data.expires_at) {
        tokenExpiresAt = new Date(data.expires_at).getTime();
    } else if (data.expires_in) {
        tokenExpiresAt = now + Number(data.expires_in) * 1000;
    } else {
        tokenExpiresAt = now + 25 * 60 * 1000;
    }

    return cachedToken;
}

async function createPayment({ amount, currency, orderId, paymentMethodType, customer }) {
    const token = await getAccessToken();
    const baseUrl = getBaseUrl();
    const requestId = buildRequestId('airwallex_pi');
    const returnUrl = `${process.env.APP_URL || 'http://localhost:3001'}/api/payments/callback/airwallex?order_id=${orderId}`;

    let createResponse;
    try {
        createResponse = await axios.post(
            `${baseUrl}/api/v1/pa/payment_intents/create`,
            {
                request_id: requestId,
                amount,
                currency,
                merchant_order_id: String(orderId),
                return_url: returnUrl
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (err) {
        const details = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Airwallex create intent failed: ${details}`);
    }

    const intent = createResponse.data || {};
    const paymentIntentId = intent.id || intent.payment_intent_id || intent.payment_intent?.id;
    if (!paymentIntentId) {
        throw new Error('Airwallex payment intent not created');
    }

    const resolvedType = paymentMethodType === 'paynow' ? 'pay_now' : paymentMethodType;
    const confirmRequest = {
        request_id: buildRequestId('airwallex_confirm'),
        payment_method: {
            type: resolvedType || 'pay_now'
        }
    };

    if (customer && customer.name && (resolvedType === 'pay_now')) {
        confirmRequest.payment_method.paynow = { shopper_name: customer.name };
    }

    let confirmResponse;
    try {
        confirmResponse = await axios.post(
            `${baseUrl}/api/v1/pa/payment_intents/${paymentIntentId}/confirm`,
            confirmRequest,
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );
    } catch (err) {
        const details = err.response && err.response.data ? JSON.stringify(err.response.data) : err.message;
        throw new Error(`Airwallex confirm failed: ${details}`);
    }

    const confirmData = confirmResponse.data || {};
    const nextAction =
        confirmData.next_action ||
        confirmData.payment_intent?.next_action ||
        confirmData.data?.next_action ||
        {};

    const qrCode =
        nextAction.qr_code ||
        nextAction.qrcode ||
        nextAction.data?.qr_code ||
        nextAction.data?.qrcode ||
        null;

    const checkoutUrl =
        nextAction.url ||
        nextAction.redirect_url ||
        nextAction.data?.url ||
        null;

    return {
        providerRef: paymentIntentId,
        checkoutUrl,
        qrCode
    };
}

async function getPaymentIntent(paymentIntentId) {
    const token = await getAccessToken();
    const response = await axios.get(
        `${getBaseUrl()}/api/v1/pa/payment_intents/${paymentIntentId}`,
        {
            headers: {
                Authorization: `Bearer ${token}`
            }
        }
    );
    return response.data || {};
}

module.exports = {
    createPayment,
    getPaymentIntent
};
