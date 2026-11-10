# Payments: before real money

## Razorpay dashboard (every shop account AND the platform account)
1. **Payment capture = Automatic.** The app treats a payment as paid only when Razorpay says `captured`. With manual capture the
   money stays "authorized", the order never turns paid and Razorpay returns it after about 5 days.
2. **Webhook** (Settings, Webhooks): paste the URL and the secret from the superadmin app. Tick these events:
   `payment.captured`, `payment.failed`, `refund.processed`, `refund.failed`, `qr_code.credited`, and the six
   `payment.dispute.*` events. Shops set up before 2026-11-02 need `qr_code.credited` ticked by hand.
3. **Balance for refunds.** A refund comes out of the shop's own Razorpay balance. With too little balance the refund waits
   and is sent by itself once balance is added. The owner gets a message in the app (once) and the superadmin gets an alert.

## Server
- `PAYMENTS_MOCK` must be `false` (the server refuses to start in production with mock on). `ALLOW_PAYMENTS_MOCK_IN_PROD` must not be `true`.
- `SECRETS_KEY` encrypts every saved Razorpay secret. **If it is lost or changed, every saved key becomes unreadable.**
  Keep a copy somewhere safe and separate from the database and the server (password manager, printed in a safe).
  At every start the server tries to read every saved key and alerts the superadmin if any cannot be read; the shop's
  payment status screen also shows a warning. Fix: put the old `SECRETS_KEY` back, or save the keys again.
- `PUBLIC_BASE_URL` must be the real address, so the webhook URLs shown in the app are right.

## First live check
1. Test keys first: one payment, one cancel with refund, one webhook, one dispute.
2. Live keys: a real Rs 1 order, then refund it.
3. Every shop's checklist in the superadmin app is fully ticked, including "webhook event received".

## Rules the code follows (so you know what to expect)
- The server decides every amount. A payment of a different amount is refunded in full and nothing is marked paid
  (orders, table booking deposits, table bills, unpaid table bills).
- A refund is saved with a fixed key first, so it can never go out twice; a retry asks Razorpay first.
- Every 2 minutes a job repairs payments whose webhook was missed or whose follow-up work stopped half way.
- Money that arrives on the platform account and matches no plan payment or top-up raises an alert.

## Plans, wallet, refunds and disputes (the platform account)
1. The platform account's webhook also needs `payment.dispute.*` ticked: a bank dispute on a plan payment, wallet top-up or SMS top-up alerts you, blocks a refund of that payment while open, and takes the service back (with a credit note) if it is lost. Close one by hand in More > Plans overview if the notice never comes.
2. "Send money back" refunds through the platform Razorpay account, so it needs balance there. A refund the server could not finish is finished or undone within minutes by itself.
3. Fill in Business details (legal name, GSTIN, address, state) before the first payment: invoices and credit notes need them.
4. The database must be a replica set (the wallet and plan payments use transactions). Atlas is one by default.
5. `PARTNER_FEES=off` is the kill switch for per-order wallet fees (plans keep working).
6. Test once in Razorpay TEST mode before real money: a plan payment, a coupon, a refund, a dispute notice. Steps: `docs/plans-phone-test.md`.
