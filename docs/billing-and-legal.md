# Billing, papers and legal position (a working note, not legal advice)

I am a software assistant, not a CA or a lawyer. This is how the app behaves today and what usually matters; have your CA and lawyer confirm the legal points. The questions to take to the CA are in `docs/ca-pack-plans` (with sample invoices). Plans and prices: `docs/plans-and-pricing.md`.

## 1. Who pays whom, and the paper for each
| Money | From | To | Paper |
|---|---|---|---|
| Food | customer | the shop | order invoice PDF (shop name, GSTIN and FSSAI if saved; CGST/SGST when the shop charges GST) |
| Plan, extra shops | the shop | the platform company | numbered tax invoice `PLN/...` (PDF in the owner's Plan > Payments) |
| Partner wallet top-up | the shop | the platform company | tax invoice `TOP/...` (PDF in the wallet history). Wallet money is the shop's prepaid balance; the per-order fee (Rs 3 to Rs 15) is taken from it when an order completes |
| SMS top-up | the shop | the platform company | invoice or receipt `TOP/...` |
| Money sent back or taken back | the platform | the shop | credit note `CN/...` (refund by the admin, or a bank dispute the platform lost) |
| Payment made outside the app | the shop | the platform company | the same `PLN/...` invoice, marked "bank transfer", "UPI" or "cash" with your reference |
| Rider pay | the shop | the rider | earnings and cash screens; no statement PDF |

Seller and buyer details are copied onto every document when it is made, so changing the business details later never changes an old document. GST is added only while the platform business has a GSTIN saved. CGST+SGST or IGST follows the shop's state.

## 2. The company and the GST number
The platform company's name, address, GSTIN, PAN and SAC code are settings (superadmin: Money > Business details). Whoever's GSTIN is on the invoice is the legal supplier and must receive the money (check whose bank account and Razorpay account is used).

**To move to another company later, in order:** register the new business (a proprietorship costs little: PAN, a bank account, a free Udyam registration) and its bank account; open a Razorpay account for it and put the new keys in Money > My Razorpay; put the new details in Business details (new documents show the new company; use a new invoice prefix for a new GSTIN); tell every shop by a policy notice and update the Terms and Privacy; move the Play Store, domain, SMS (DLT) registration and cloud accounts.

## 3. Shops without a GST number
Razorpay usually accepts proprietorships with PAN, a bank account and a business proof (a restaurant needs an FSSAI licence). Cash on delivery works with no payment account. A shop without a GSTIN gets "INVOICE" with no tax on its order invoices; with a GSTIN it gets "TAX INVOICE" with CGST and SGST. The platform's own invoices charge GST only when the platform business has a GSTIN; shops with a GSTIN can use them for input credit.

## 4. What is built, and what still needs a human
Built: numbered tax invoices with place of supply, the tax split and "reverse charge: no"; credit notes; a GST register by month in Excel (the CA's layout); Terms and Privacy as real pages in the apps; refunds, bank disputes, held payments and the money screens all agree because they read one list of paid documents.

Still needs a human:
1. **Your CA** on the points in `docs/ca-pack-plans/QUESTIONS-FOR-THE-CA.pdf`: GST on plans, wallet top-ups and the per-order fee; credit notes for refunds and lost chargebacks; the "no refunds" rule; when wallet money counts as income; coupons; e-invoicing; invoice numbering; section 9(5) / TCS.
2. **A lawyer** on the Terms of Service, the Privacy Policy and the "no refund" wording, the written agreement between Ankit and Vivek (`docs/agreement-ankit-vivek.md`, `docs/mou-addendum-plans.md`), a written rider agreement, and the data-protection duties (who accepted which version).

## 5. Agreements on paper (no software replaces these)
Platform to shop (the Terms: who the operator is, plans and fees, no refunds, what happens when a plan is not renewed: the shop is paused for new orders); shop to rider; the arrangement with the company whose GSTIN you use now (section 2); a privacy notice naming the company that holds customer data.
