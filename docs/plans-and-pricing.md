# Plans and pricing (current state, 2026-11-10)

Three plans. Everything is prepaid. No late fee, no bills after the fact (the old monthly rent model is gone). Test list: `docs/plans-phone-test.md`. Questions for the CA: `docs/ca-pack-plans`.

| | Partner | Growth | Pro |
|---|---|---|---|
| Price | Rs 0 a month; Rs 3 to Rs 15 per completed order from a prepaid wallet | Rs 2,999 a month + GST, paid in advance | Rs 4,999 a month + GST, paid in advance |
| Delivery and pickup (the owner switches each in Shop settings) | yes | yes | yes |
| Customer app on website and phone, order timeline, rider Call button, coupons, tax invoices, languages | yes | yes | yes |
| Table booking, with a waitlist for full slots (needs your per-shop switch) | yes | yes | yes |
| **Dine-in ordering with QR tables** (table bills, waiter calls) | no | yes | yes |
| Rider live map for customers | no | yes | yes |
| Riders | up to 2 | unlimited | unlimited |
| Kitchen and waiter logins | none | up to 5 | unlimited |
| Soundbox voice, services and inquiries, loyalty, auto-accept, costs and profit | no | yes | yes |
| Bulk orders, analytics and PDF reports, push offers and daily push, full exports, multi-branch, custom domain (later) | no | no | yes |
| Exports | money columns only | money columns only | everything |

**Which plan has which feature is not fixed in stone:** the supreme admin edits it in More > Plan defaults > What each plan includes. Taking a feature away from Growth or Pro lets the shops already on it keep it until their term ends; adding one reaches everyone at once. Kitchen and waiter logins and the rider limit stay in the code. Dine-in lives in the same table.

## Money rules
- **Prepaid, one plan at a time.** Owner pays for 1 to 6 months at once, at most 12 months prepaid in total. Renewing adds the new months after the current end.
- **Discounts:** 3 months 5% and 6 months 10%, nothing else. A coupon never adds to it: the better of the two applies. GST is added after the discount.
- **Upgrade:** pay only the difference for the whole days left, starts at once, end date unchanged. No month discount or coupon on an upgrade.
- **Lower plan:** waits for the end of the paid time (nothing is paid now). During a FREE period an owner can prepay a lower plan: it starts when the free days end ("Already paid").
- **Free days left** are added at the end when an owner buys another plan during a free period.
- **Plan ends:** reminders 7, 3 and 1 days before, then grace days (default 3), then the shop is paused for new orders (orders in progress finish). Paying, or choosing Partner, opens it again at once.
- **Partner wallet:** top-up with GST on top; the fee is taken when an order completes, from the order value at checkout; overdraft about Rs 100; at zero only new orders pause. Fee slabs are never shown to owners.
- **Coupons** (More > Plan coupons): percentage off, for Growth, Pro or both, for 3 or 6 months or any term, once per shop, with a use limit, edit, delete (unused), and a push to the shops that can use it.
- **No refunds** (stated on the Plan screen and in the Terms) except mistakes, done by the supreme admin with "Send money back" (real money back through Razorpay, a credit note, one at a time per shop).

## What the supreme admin can do (all in the superadmin app)
Plan defaults (prices, slabs, free and grace days, GST, branches, discounts, features) · a shop's Plan screen (switch plan, free period start and end, remove the plan, give more time, record a payment made outside the app with an invoice, own price / free days / fee slabs, extras, website and app switches, wallet corrections, Send money back) · Plans overview (who is on what, ending soon, ended, held payments, bank disputes) · Plan coupons · Move shops to plans (dry run first, undoable) · Money tab (profit this week, month and year; profit and loss by week, month and financial year).

## Things the app watches for you
A refund the server left half-done is finished or undone; a bank dispute on a plan, wallet or SMS payment alerts you, blocks a refund of that payment while open, and takes the service back (with a credit note) when lost; held payments and open disputes are reminded every morning at 10:00; Partner shops whose orders drop by half or are often not completed are flagged every night.
