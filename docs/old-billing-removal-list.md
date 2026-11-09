# Old billing: REMOVED (2026-11-09)

Nothing was live, every shop was dummy data, so the old monthly-rent billing model was deleted completely (no "keep old invoices" step).
Everything on the platform is now **prepaid**: a plan payment, an extra shop, a Partner wallet top-up, an SMS top-up. Nobody owes anything, so nothing is overdue.

## What is gone
| Old thing | Replaced by |
|---|---|
| `SubscriptionInvoice`, `CreditNote`, `DuesPayment`, `CollectionNote` models | `PlanPayment`, `PartnerTopup`, `SmsTopup` (each carries its own invoice) |
| Monthly invoice generation, tiers, free orders / free months, go-live billing, pooled brand free time, brand rent discount | the plan, free days on the plan, 3 free shops per brand + Rs 1,499 per extra shop |
| Late fees, overdue reminders, grace by invoice, paused-for-rent, shop closed for rent, "shops to close" list | plan end, grace days and pause in `planLifecycle.js`; a shop is closed only by hand (`shopClosure.js`) |
| Owner "Rent" screen, "Bills and SMS" hub, billing prompts, pay-all-dues, brand statement and dues | Plan screen, Wallet screen, SMS screen, plan invoices (PDF) |
| Superadmin Receivables, Rent invoices, invoice detail, custom invoice, Shop billing, Shops to close, billing rules, brand bulk billing, brand free start | Shop Plan screen, Ledger, Month close, GST register, Profit and loss |
| Receivable / aging logic in `financeService` | gone; income = plan and extra-shop payments (no GST) + per-order fees taken from wallets + SMS margin |

## What every money screen reads now
`services/platformSales.js` is the one list of what the platform was paid (plan, extra shop, wallet top-up, SMS top-up). The ledger, GST register, month close,
profit and loss, exports, health card, Money search, daily digest and the owner's own money list all read it, so their numbers agree.
Ledger categories on the platform side are `plan`, `wallet`, `sms_topup` (the owner's "Transactions" tab: `plan`, `wallet`, `sms_topup`, customer money).

## Kept on purpose
`platformInvoicing.js` (numbers every invoice), `subscriptionInvoicePdf.js` (draws the PDF), `planBilling.js`, `planLifecycle.js`, SMS wallet and top-ups,
`shopClosure.js` (manual closing only), `Tenant.billing.isLive` (the "gone live" flag).

## Tests
The old tests (`billing`, `brandBilling`, `brandPayAll`, `brandStatementPdf`, `oldBillsDues`, `rentSummary`, `ownerPlatformPay`, `platformInvoices`, `collectionNotes`) were deleted.
The others were moved to the new model; `tests/helpers/planPay.js` makes a paid plan payment for them.
