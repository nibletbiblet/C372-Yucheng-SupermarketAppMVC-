const makePayNowQrSvg = (amount) => {
    const text = `PAYNOW SGD ${amount}`;
    return `
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="20" y="20" width="60" height="60" fill="#000000"/>
  <rect x="160" y="20" width="60" height="60" fill="#000000"/>
  <rect x="20" y="160" width="60" height="60" fill="#000000"/>
  <rect x="90" y="90" width="60" height="60" fill="#000000"/>
  <text x="120" y="220" text-anchor="middle" font-size="12" fill="#111111" font-family="Arial">${text}</text>
</svg>`;
};

exports.generateQrCode = async (req, res) => {
    const { cartTotal } = req.body;
    const amount = (parseFloat(cartTotal || 0) || 0).toFixed(2);

    if (!amount || Number(amount) <= 0) {
        return res.render('netsQrFail', {
            title: 'Error',
            responseCode: 'N.A.',
            instructions: '',
            errorMsg: 'Invalid amount for PayNow.'
        });
    }

    const svg = makePayNowQrSvg(amount);
    const qrCodeUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

    res.render('paynowQr', {
        total: amount,
        title: 'PayNow QR',
        qrCodeUrl
    });
};
