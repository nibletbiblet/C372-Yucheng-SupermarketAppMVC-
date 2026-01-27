async function createPayment() {
    const ref = `BANK-${Date.now()}`;
    return { providerRef: ref, instructions: 'PayNow/Bank transfer reference' };
}

module.exports = { createPayment };
