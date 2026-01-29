# AI Journal - CA2 Payments & Refunds

Date: 2026-01-28

## What the AI suggested
- Add database compatibility migrations for wallet, payments, refund requests, and order status fields.
- Implement a new refund request workflow (model/controller/routes) that reads existing orders/payments and credits wallet balance.
- Add a new admin order history page showing order/payment/refund status.
- Tidy the payment UI via CSS only to keep existing JS logic stable.

## What was accepted / rejected (and why)
- Accepted: migration scripts in `scripts/` to add missing tables/columns using `information_schema` checks.
- Accepted: additive refund request workflow with new controller and routes (no changes to existing payment logic).
- Accepted: new admin order history view and route.
- Accepted: payment UI polish using a new CSS file and a safe stylesheet include in `views/payment.ejs`.
- Rejected: modifying any existing payment controllers, provider integrations, or `/api/payments/*` endpoints to avoid breaking working flows.

## Security & validation notes
- Refund requests validate ownership (order belongs to the logged-in user).
- Refunds only allowed for PAID/HELD orders.
- Amount capped at paid/order totals and blocks duplicate PENDING requests.
- Admin refund decisions require admin role.
- Wallet credits are performed server-side only.

## Testing performed
- Not run (manual testing recommended).

## File references
- `scripts/20260128_wallet_refund_setup.sql`
- `scripts/20260128_refund_requests_setup.sql`
- `controllers/refundRequestsController.js`
- `controllers/adminOrdersController.js`
- `routes/refundRequestsRoutes.js`
- `routes/adminRefundRequestsRoutes.js`
- `routes/adminOrdersRoutes.js`
- `views/refunds_new.ejs`
- `views/adminRefundRequests_new.ejs`
- `views/adminOrders_new.ejs`
- `public/css/payment_tidy.css`
- `views/payment.ejs`

Note: No payment controller or existing payment endpoint logic was modified.
