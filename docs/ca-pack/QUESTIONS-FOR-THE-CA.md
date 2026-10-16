# Questions for the CA (take this page and the six sample files)

All six files in this folder are SAMPLES made by the app's real invoice code with fake names and fake numbers. Nothing here is a real invoice.

| File | What it shows |
|---|---|
| 1-sample-rent-bill-same-state-CGST-SGST.pdf | A monthly rent bill to a shop in the same state (CGST + SGST) |
| 2-sample-rent-bill-other-state-IGST.pdf | The same to a shop in another state (IGST) |
| 3-sample-SMS-top-up-receipt.pdf | The invoice for an SMS balance top-up |
| 4-sample-credit-note.pdf | A credit note for a cancelled bill |
| 5-sample-bill-to-shop-without-GST-number.pdf | A bill to a shop that has no GST number |
| 6-sample-GST-register.xlsx | The monthly register the operator files from |

## The setup in two lines
Ankit owns the software platform. For the first year Vivek's business (with its GST number and Razorpay account) is the operator and issues the invoices to the shops; Ankit and Vivek share the money. After a year Ankit moves billing to his own business.

## Please tell us
1. **Which SAC code** is right for this service (a monthly subscription for ordering, delivery and shop software), and **is 18% the right rate**? The samples show "CA to confirm".
2. **Is the invoice complete?** Does it have everything a GST invoice must show? Is anything missing, wrong or in the wrong place?
3. **Place of supply** for a shop with no GST number: we use the state in its address (or the seller's state if unknown). Is that right?
4. **SMS top-up:** we charge GST on top of the amount typed and issue an invoice at the time of payment. Is that the right time and form (invoice or receipt voucher)? How should a **refund of unused balance** be treated (credit note)?
5. **Credit note:** we issue one automatically when an already-issued bill is cancelled. Is the format and timing right?
6. **The arrangement with Vivek:** the invoices are in his business name with his GST number, and Ankit's share is paid to Ankit. How should Ankit's share be treated (invoice to Vivek? TDS?) and does Ankit need his own registration at this size?
7. **Section 9(5) / e-commerce operator rules:** customers order from each shop's own app and pay the shop's own payment account. Does any GST or TCS duty fall on the platform for those orders?
8. **E-invoicing (IRN/QR):** at the current turnover is it needed? From what limit?
9. **Invoice numbers:** we use `SUB/2026-27/0001` (16 characters) and, with a prefix, `BABC/26-27/0001`. A new prefix starts a new series when the GST number changes. Is that acceptable?
10. **Payments between the two of them** (the 50/50 and 70/30 shares, shared costs): any tax or record-keeping we should do beyond the settlement sheet?

## Also ask a lawyer
The written agreement between Ankit and Vivek (the plain draft is in `docs/agreement-ankit-vivek.md`), the Terms of Service and the Privacy Policy (drafts are in the admin app), and the data protection obligations.
