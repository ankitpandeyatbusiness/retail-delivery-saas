# Operator, settlement sheet, agreements and the Switch

Not legal advice. Everything here is software; the signed paper agreement between the two partners is the main document.

## Who can do what
- **Supreme admin:** the superadmin whose login phone is `SUPREME_ADMIN_PHONE` (default 8318538918, set in `backend/.env`). It is not editable from any panel. `GET /api/admin/me` says `supreme: true` for this account.
- **Every other superadmin:** sees everything they saw before, plus the settlement sheet, the GST register, the companies and the agreements as **read-only**.
- **What only the supreme admin changes** (the server answers 403 to anyone else; one list in `backend/src/middlewares/supremeAdmin.js`): business details, billing rules and tiers, GST, Razorpay keys, SMS prices, a shop's fee plan and billing (go-live, unpause), custom bills, bill status, void and waive, a shop's SMS wallet and prices, the platform's expenses, the settlement sheet, companies and Switch, agreements.
- One exception: any superadmin can add an **"I have paid" note** on a settlement row (the supreme admin confirms it).

## Invoices (platform to shop)
- Rent and setup bills `SUB/2026-27/0001` (with a prefix of up to 4 letters: `BABC/26-27/0001`; GST allows 16 characters at most), SMS top-up invoices `TOP/...`, credit notes `CN/...`. The **prefix** is a field in Business details (or in the company profile). A new prefix starts a new series from 0001; it locks once a bill with it exists.
- Every bill carries the seller (name, address, GSTIN, PAN, state), the buyer, the **place of supply**, "reverse charge: No", and the tax as **CGST + SGST** (same state) or **IGST** (other state). The shop's state is in its address (owner app: Shop settings; superadmin: shop form). An unknown state counts as the seller's state.
- GST is charged only while the platform business has a GST number saved. SMS top-ups add the GST on top of the amount typed (minimum Rs 100).
- Cancelling an issued bill (void or waive) issues a **credit note** automatically. Owners open credit notes and top-up invoices from the app.
- **GST register** (superadmin: More, GST register): all bills, top-up invoices and credit notes of a month with taxable value, CGST, SGST, IGST, B2B/B2C and the GST due on unpaid bills; Excel download. This is what the operator files his returns from.

## The settlement sheet (More, Settlement sheet)
- A row appears by itself when a shop pays rent, a setup fee or an SMS top-up. It is shared on the amount **before GST**: shop brought by the partner 50/50, by the owner 70/30 (these numbers are settings). Shared costs (SMS recharge, server, database, API, misc) are always 50/50: one partner paid all, the other owes his half.
- The partner has to pay within **15 days** (a setting). After that the row shows as late.
- Rows are never deleted. Every change is an event on the row's timeline (who, when, amount, reference, note).
- The supreme admin records payments, confirms "I have paid" notes, sets rows off against each other (with a reason typed by hand), adds costs and adjustments, marks **who brought a shop** (shop detail, or when creating a shop) and changes names and ratios. Changing who brought a shop fixes the unpaid rows and never rewrites a row money was already settled on.
- The supreme admin gets a notification (inbox and push, nobody else) for every payment: who paid, how much, and what the partner owes.
- Excel download of the whole sheet. After the switch (mode "all yours") new payments show nothing to settle.
- When a bill is marked paid by hand, `receivedBy` says who got the money (default: the operator's account).

## Agreements and terms (More, Agreements and terms)
Six documents: the operating agreement between the two partners, terms for the other superadmins, shop owners, riders, and (read-only for customers) Terms of Service and the Privacy Policy. The supreme admin edits the draft and presses **Send new version**; it freezes the text with the names filled in (words in `{{double braces}}` come from the company details and the sheet's names; text in [square brackets] are blanks that must be filled before it can be sent).
- Who is asked: the account marked **partner** gets the operating agreement, every other superadmin the administrators' terms, owners and riders their own terms. The supreme admin is not asked. Customers are not asked; they read the pages (login screen, Account, and the web pages `/legal/terms` and `/legal/privacy` for the store listing).
- **When:** on the person's **second visit** after the version was sent (a visit = opening the app after at least 30 minutes away), never the first. Owners and riders only after the supreme admin pressed **Mark as handed over** on their shop. Owner terms can be sent as "ask when the free period ends".
- The agree screen is full-screen and cannot be closed: "Agree and continue" or "Log out". Each acceptance saves who, when, the version and the company in force. Once agreed, people can only read it.
- The supreme admin sees who agreed and who is waiting.

## Companies and Switch (More, Companies and Switch)
- A company profile holds the legal name, address, GSTIN, PAN, state, SAC, **invoice prefix**, "Powered by" name and contact number, mail details, its Razorpay keys (write only, encrypted) and how its money is shared.
- First press **Save the current company** (what is live now, keys included). Then add the second company (your own agency) and its Razorpay keys.
- **Switch** shows a checklist (company details, Razorpay keys, a new numbering, open bills, rows still unsettled, prepaid SMS balances, terms sent) and refuses to go while a ✕ item is open. Pressing it copies the company into the live settings, starts the new numbering, sets the sheet mode, tells every shop (in-app message and email) and writes it down. Old bills keep the seller they were made with.
- After switching: test the new Razorpay keys (Money, My Razorpay), send the owner and rider terms again, and start the SMS (DLT) registration for the new company a month before.

## "Powered by" in the customer app
Login screen and Account show "Powered by <name>" with a **Contact** button that calls the contact number. Both come from the active company, so they change with the switch.

## Tests
`backend/tests/platformInvoices.test.js`, `settlement.test.js`, `legal.test.js`, `operators.test.js`.
