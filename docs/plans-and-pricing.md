# Plans and pricing (built in phases 1 to 8, 2026-11)

Three plans. Everything is prepaid. No late fee. Old monthly rent, price tiers, go live and free orders/months are gone (docs/old-billing-removal-list.md).

| | Partner | Growth | Pro |
|---|---|---|---|
| Price | Rs 0 rent; Rs 3 to Rs 15 per completed order from a prepaid wallet | Rs 2,999 per month + GST | Rs 4,999 per month + GST |
| Customer app, web and app, push, order timeline, rider Call button, dine-in QR, waitlist, table booking | yes | yes | yes |
| Rider live map for customers | no | yes | yes |
| Riders | up to 2 | unlimited | unlimited |
| Kitchen and waiter logins | none | up to 5 | unlimited |
| Soundbox voice, services and inquiries, loyalty, auto-accept, costs and profit | no | yes | yes |
| Bulk orders, full exports, analytics, custom push, multi-branch, custom domain | no | no | yes |
| Exports | money columns only | money columns only | everything |

All values are defaults in `backend/src/config/plans.js` and editable by the supreme admin (More > Plan defaults, and per shop). Prices, fee slabs, free days, grace days, GST, branch add-on and multi-month discounts are settings.

## Where things live
- **Catalog and gates:** `config/plans.js`, `services/featureGate.js` (`hasFeature`, `planGate`, `limitOf`). The server refuses first; the apps hide second ("Available in Pro").
- **A shop's plan:** `Tenant.plan` (id, endsAt, freeUntil, extras, scheduled, paused, price/free-days overrides, webEnabled/nativeEnabled). A shop with no plan yet is not limited until it is moved (phase 9).
- **Partner wallet:** `services/partnerWalletService.js` (ledger, fee per completed order from the order value at checkout, overdraft Rs 100, kill switch `PARTNER_FEES=off`), top-up through `platformCheckout.startPartnerTopup`.
- **Owner pays:** `services/planBilling.js` (quote, preview, pay, upgrade by whole days, wallet credit, GST once, held payments), screens: owner Plan and Wallet.
- **Lifecycle:** `services/planLifecycle.js` (7/3/1 day reminders, end, grace days, pause, scheduled lower plan, wallet low/empty).
- **Preview before creating a shop:** superadmin new-shop wizard shows the customer app and the owner menu as that plan gives them.

## To confirm with your CA
GST on the per-order fee and on wallet top-ups; the SAC code; delivery charge excluded from the fee base; the Terms wording (shop owner Terms sections 3, 4, 6, 11 were rewritten for plans and need a lawyer's check).
