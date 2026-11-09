# Old billing: what phase 8 would remove (list for approval, nothing deleted yet)

Made 2026-11-09. Rule from the plan: replace the old rent billing with the plan billing everywhere, but KEEP past invoices, credit notes and the free-period controls,
and never delete an old open invoice (per shop: keep, waive or close it; nothing is deleted). So anything needed to pay, waive, view or print an OLD invoice stays until
phase 9 has moved every shop and its old bills are settled.

## A. REMOVE (the old money rules)
| What | Where | Why it goes |
|---|---|---|
| Monthly rent invoice generation, the monthly scheduler | `services/subscriptionService.js` (buildInvoice, createInvoice, generateForPeriod, startBillingScheduler), `POST /subscriptions/invoices/generate` in `routes/adminSubscriptionRouter.js`, `startBillingScheduler` in `server/server.js` | New shops pay plans, not monthly rent |
| Order-count price tiers and the tier editor | `PUT /platform/billing/tiers`, `tiersOverride`, `fixedFeeOverride`, `PlatformSettings.billing.tiers`, `resolveFee/resolveTiers/tierTable`, `components/tiersEditor.jsx` (superadmin) | Replaced by Partner/Growth/Pro prices |
| Billable-order counting | `services/billableService.js`, `billing.billableCount/deliveredCount` | Only fed the tiers |
| Go live, free orders / free months, pooled free time | `POST /tenants/:tid/billing/go-live`, `freeOrdersOverride`, `freeMonthsOverride`, `services/brandFreePool.js`, `billing.pooled`, `isLive` | Free period is now the plan's free days. (The End free period control is kept, see C.) |
| Brand multi-branch rent discount | `services/brandBulkBilling.js` (discount part), `PlatformSettings.brand.*Discount`, `brandDiscount()` | Replaced by the branch add-on line on the plan |
| Late fees | `services/lateFees.js`, `lateFee` fields, `POST /tenants/:tid/invoices/late-fees/waive-all`, `lateFeePercent/lateFeeEveryDays`, the owner "late fee" line | "No late fee" (already skipped for shops on a plan since phase 6) |
| Rent reminders / overdue nudges / grace by invoice | `services/rentReminder.js`, `billingAlerts` steps: billIssued, graceReminders, pausedNotices, overdueReminders, freeEnding; `services/billingEnforcement.js` (rent grace and pause) + its scheduler; `billingPromptService.js` bill prompts | Replaced by `planLifecycle.js` (7/3/1, ended, grace, pause) |
| Fee-plan change notices | `services/feePlanNotice.js` | Told owners about tier changes |
| Superadmin screens | `screens/money/PlatformBillingScreen.jsx` (billing rules), `ShopBillingScreen.jsx` (a shop's fee plan, go live), the Billing rules row in Money settings, the "Own rent plan" badge, rent chips on shop cards | Replaced by Plan defaults + the shop Plan screen |
| Owner screens | the "next bill / this month's rent / tier" part of `OwnerRentScreen.jsx`, the Rent card in `OwnerMoneyScreen.jsx`, `BillingPrompt.jsx` bill prompts, the "Pay rent" banner path (kept only while old bills are open) | Replaced by the Plan screen |
| Legal and help wording about rent tiers, free orders, late fees | `utils/common/legalTexts.js`, `docs/billing-and-legal.md`, the DLT/alert texts for bill_issued, bill_reminder, bill_overdue, rent_nudge | Wording must say plans, wallet, no late fee |

## B. KEEP until every old bill is settled (needed to pay / waive / view old invoices)
`models/SubscriptionInvoice.js`, `CreditNote.js`, `DuesPayment.js`; `services/rentPaymentService.js`, `dues.js`, `creditNotes.js`, `subscriptionInvoicePdf.js`;
`shopSubscriptionRouter.js` (invoice list, PDF, pay one, pay all dues); `adminSubscriptionRouter.js` (list, view, PDF, status); void / waive / extend-grace in `adminBillingRouter.js`;
`startRent / startDues / startBrandDues` in `platformCheckout.js`; `OwnerPayScreen` kinds rent / dues / branchdues; Receivables screen (who still owes).
These shrink to nothing by themselves once the last old bill is paid or waived; removing them then is a small last step.

## C. KEEP for good (not old billing, or still needed)
`platformInvoicing.js` (numbers every plan, wallet and SMS invoice), `planBilling.js`, `planLifecycle.js`, wallet and plan screens, SMS wallet and SMS top-up and `smsBalances` alerts (the SMS step of billingAlerts stays),
`shopClosure.js` (closing a shop; its "closed for rent" kind is only used for old bills), the End free period control and `unpause`, `maintenance`, settlement and operator year (`docs/operator-and-settlement.md`),
money ledger, profit/loss and month close (they read invoices and payments, not the rules).

## D. CHANGE (not delete)
- `rentSummary.js` and the shop list: show the plan line (done in phase 1) instead of the rent answer; keep "owes old bills" for shops that still have them.
- Superadmin Home, Money Home and Receivables: add plan payments and wallet top-ups to the money in; keep the old invoices part while they exist.
- `billingAlerts.js`: keep the runner with `closureSweep`, `planSweep`, `paymentsReceived`, `smsBalances` only.
- Exports and the money search that mention "rent" or "bill status".
- Tests: about 31 test files touch these; the ones for removed rules (billing tiers, brandFreePool, lateFees, rent reminders, brandRentPreview, billingPause for rent) are deleted or rewritten, the rest keep running.

## Order of work if you approve
1. Stop generation first (monthly scheduler, generate route, go live, tiers, late fees, rent reminders, rent enforcement). Nothing is deleted from the database. Run the full test suite.
2. Remove the old superadmin and owner screens that only edited those rules; point the old routes at nothing. Run the tests.
3. Rewrite the legal and help wording. Rewrite or delete the tests of the removed rules.
4. Keep section B until phase 9 has moved every shop and the old open bills are listed with keep / waive / close per shop.
