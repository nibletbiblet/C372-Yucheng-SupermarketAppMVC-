const querystring = require('querystring');

async function createPayment({ amount, orderId, methodTypes }) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error('Stripe is not configured');
    }

    const baseUrl = process.env.APP_URL || 'http://localhost:3001';

    const types = Array.isArray(methodTypes) && methodTypes.length > 0 ? methodTypes : ['card'];
    const bodyFields = {
        mode: 'payment',
        success_url: `${baseUrl}/api/payments/callback/stripe?session_id={CHECKOUT_SESSION_ID}&order_id=${orderId}`,
        cancel_url: `${baseUrl}/checkout/payment`,
        'line_items[0][price_data][currency]': 'sgd',
        'line_items[0][price_data][product_data][name]': 'FreshMarket Order',
        'line_items[0][price_data][unit_amount]': Math.round(amount * 100),
        'line_items[0][quantity]': 1
    };

    types.forEach((type, index) => {
        bodyFields[`payment_method_types[${index}]`] = type;
    });

    const body = querystring.stringify(bodyFields);

    const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${secretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error && data.error.message ? data.error.message : 'Stripe session failed');
    }

    return {
        providerRef: data.id,
        checkoutUrl: data.url
    };
}

module.exports = { createPayment };
