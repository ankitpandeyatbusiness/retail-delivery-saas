# Paying on the website (web phase 5)

## How it works
- The server side is **unchanged**: the server makes the Razorpay order with the shop's own keys, the customer pays, the proof
  (`razorpay_order_id`, `razorpay_payment_id`, `razorpay_signature`) goes back to the server, which verifies it with Razorpay.
- The phone app opens a UPI app directly (Razorpay's Custom UI SDK). A website cannot, so on the web `src/web/shims/razorpay.js` opens
  **Razorpay's own hosted payment window** (checkout.js). It offers UPI (QR / UPI id / app), cards, netbanking and wallets itself.
  The website never sees card numbers.
- Every payment uses the same call, so one stand-in covers: orders, table-booking deposits, bulk orders, table bills, owed amounts and the
  owner's plan / wallet payments.
- Payment methods screen on web: ONE row, **Pay online** ("UPI, cards, netbanking and wallets"). No UPI app list, no card form.
  The phone app's screen is unchanged. Closing the window counts as "cancelled" (the order is withdrawn, as on the phone).

## Before real money can flow on a shop's website
- **Razorpay checks the website address.** In each shop's own Razorpay dashboard the website (`https://<shop>.<domain>`) must be added / approved
  (Account & Settings > Website and app details). Test keys work from any address (including localhost). Without this, live payments from the website are refused by Razorpay.
- No server change is needed for a shop that already takes online payments in the app.

## Test list (Razorpay TEST keys, a browser)
1. Log in on the website, add a dish, open the cart > Payment options: you see **Pay online** (not a list of UPI apps).
2. Pick it and place the order: the Razorpay window opens with the amount and the shop name. Pay with a Razorpay test card (4111 1111 1111 1111, any future date, any CVV, OTP 1234 or the "Success" button) or test UPI `success@razorpay`: the order shows as paid and the shop sees it.
3. Open the window again and close it: you land back in the cart, nothing was ordered, no unpaid order is left for the shop.
4. Fail a payment (test UPI `failure@razorpay`): the window offers to retry; closing it cancels.
5. Repeat with a table booking deposit, a bulk order advance, and "Pay the bill" at a table.
6. Turn the internet off before tapping Pay: a clear message, no crash.
