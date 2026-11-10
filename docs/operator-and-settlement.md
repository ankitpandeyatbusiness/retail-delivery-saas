# Operator, settlement sheet, agreements and the Switch

Not legal advice. Everything here is software; the signed paper agreement between the two partners is the main document.

## Who can do what
- **Supreme admin:** the superadmin whose login phone is `SUPREME_ADMIN_PHONE` (default 8318538918, set in `backend/.env`). It is not editable from any panel. `GET /api/admin/me` says `supreme: true` for this account.
- **Every other superadmin:** sees everything they saw before, plus the settlement sheet, the GST register, the companies and the agreements as **read-only**.
- **What only the supreme admin changes** (the server answers 403 to anyone else; one list in `backend/src/middlewares/supremeAdmin.js`): business details, plan prices and rules (Plan defaults), a shop's plan, wallet, refunds and coupons, GST, Razorpay keys, SMS prices, a shop's SMS wallet and prices, the platform's expenses, the settlement sheet, companies and Switch, agreements.
- One exception: any superadmin can add an **"I have paid" note** on a settlement row (the supreme admin confirms it).

## Invoices (platform to shop)
- Plan invoices `PLN/2026-27/0001` (with a prefix of up to 4 letters the number looks like `BABC/26-27/0001`; GST allows 16 characters at most), wallet and SMS top-up invoices `TOP/...`, credit notes `CN/...`. The **prefix** is a field in Business details (or in the company profile). A new prefix starts a new series from 0001; it locks once a document with it exists.
- Every bill carries the seller (name, address, GSTIN, PAN, state), the buyer, the **place of supply**, "reverse charge: No", and the tax as **CGST + SGST** (same state) or **IGST** (other state). The shop's state is in its address (owner app: Shop settings; superadmin: shop form). An unknown state counts as the seller's state.
- GST is charged only while the platform business has a GST number saved. SMS top-ups add the GST on top of the amount typed (minimum Rs 100).
- Cancelling an issued bill (void or waive) issues a **credit note** automatically. Owners open credit notes and top-up invoices from the app.
- **GST register** (superadmin: More, GST register): all bills, top-up invoices and credit notes of a month with taxable value, CGST, SGST, IGST, B2B/B2C and the GST due on unpaid bills; Excel download. This is what the operator files his returns from.

## Shop money (More, Shop money): replaces the settlement sheet (2026-11-04)
The settlement sheet (rows, costs, due dates, set-off, "I have paid" notes, alerts, Excel) is GONE: the developer and Vivyaan settle outside the app. What is left is a plain record.
- **Who brought the shop** stays (shop detail, and when creating a shop; supreme admin sets it): the developer 70%, Vivyaan 50% of what the shop pays before GST. A shop nobody marked counts as Vivyaan's.
- **Month page:** pick a month. Every shop that paid that month is listed under its brand (a single shop alone): plans, wallet and SMS top-ups, minus the refunds, the total before GST, the developer's part. Every superadmin login (Vivyaan's too) can read it.
- **"Did you get your part?"** one yes / no per shop and month (supreme admin only). No asks for a reason. Nothing else happens: no amounts owed, no due dates, no alerts. If a payment arrives later or "brought by" changes, the answer shows "Ask again".
- Server: `GET /api/admin/money-record?month=2026-05`, `PUT /money-record/check`, `PUT /money-record/shops/:id/brought-by` (services/moneyRecord.js, models/ShopMoneyCheck.js). Computed from the paid bills and SMS top-ups by the day the money was received; tests/moneyRecord.test.js. Old settlement rows stay in the database, unused.

## Agreements and terms (More, Agreements and terms)
Six documents: the operating agreement between the two partners, terms for the other superadmins, shop owners, riders, and (read-only for customers) Terms of Service and the Privacy Policy. The supreme admin edits the draft and presses **Send new version**; it freezes the text with the names filled in (words in `{{double braces}}` come from the company details and the sheet's names; text in [square brackets] are blanks that must be filled before it can be sent).
- Who is asked: the account marked **partner** gets the operating agreement, every other superadmin the administrators' terms, owners and riders their own terms. The supreme admin is not asked. Customers are not asked; they read the pages (login screen, Account, and the web pages `/legal/terms` and `/legal/privacy` for the store listing).
- **When:** on the person's **second visit** after the version was sent (a visit = opening the app after at least 30 minutes away), never the first. Owners and riders only after the supreme admin pressed **Mark as handed over** on their shop. Owner terms can be sent as "ask when the free period ends".
- The agree screen is full-screen and cannot be closed: "Agree and continue" or "Log out". Each acceptance saves who, when, the version and the company in force. Once agreed, people can only read it.
- The supreme admin sees who agreed and who is waiting.

## Companies and Switch: REMOVED (2026-11-04)
The Vivyaan MOU replaced the two-company year. There is one operator, Vivyaan Business Systems, and nothing rotates, so the Companies screen, the checklist and the Switch button are gone (server routes `/api/admin/operators/*`, the Operator and OperatorSwitch models, the app screens). Set the operator once in Business details and Platform payments; old saved company profiles stay in the database, unused.

## "Powered by" in the customer app
Login screen and Account show "Powered by <name>" with a **Contact** button that calls the contact number. Both come from the active company, so they change with the switch.

## Tests
`backend/tests/platformInvoices.test.js`, `settlement.test.js`, `legal.test.js`, `operators.test.js`.
