const paypalService = require('../paypal');

async function createPayment({ amount }) {
    const order = await paypalService.createOrder(amount.toFixed(2));
    return {
        providerRef: order.id,
        providerPayload: order
    };
}

async function capturePayment(providerRef) {
    return paypalService.captureOrder(providerRef);
}

async function refundPayment() {
    return false;
}

module.exports = { createPayment, capturePayment, refundPayment };
