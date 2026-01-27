async function createPayment() {
    return { providerRef: 'WALLET_INTERNAL' };
}

module.exports = { createPayment };
