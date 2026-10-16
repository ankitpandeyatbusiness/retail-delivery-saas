# Billing, papers and legal position (a working note, not legal advice)

I am a software assistant, not a CA or a lawyer. Everything below is how the app behaves today and what usually matters; please have a CA or lawyer confirm the legal points before relying on them. Rules change, so check the current ones.

## 1. Who are the parties?
| Money | From | To | Paper today |
|---|---|---|---|
| Customer pays for food | customer | the shop | order invoice PDF (shop's name, GSTIN and FSSAI if saved; CGST/SGST columns when the shop charges GST) |
| App rent (monthly) | the shop | the platform company | numbered tax invoice PDF (emailed), receipt email, VOID stamp when cancelled |
| SMS top-up | the shop | the platform company | GST now added on top (only if the platform business has a GSTIN); **no invoice document yet** |
| Rider pay | the shop | the rider | earnings and cash screens; no statement PDF |

Seller and buyer details are copied onto every invoice when it is made, so changing the business details later never changes an old invoice.

## 2. Question: the GST and the company are not mine; can I move to my own company later?
**What the app does:** the platform company's name, address, GSTIN, PAN-like details and SAC code are settings (superadmin: Platform, Business details). Each invoice keeps its own copy. So moving later is mostly a settings change: new invoices carry the new company; old invoices stay in the old company's name, which is correct.

**Using someone else's company and GSTIN today is only safe if it is a real arrangement.** Whoever's GSTIN is on the invoice is the legal supplier. That company receives the money (check whose bank account and Razorpay account receive it), must report the sales, file GST returns and pay the GST and income tax. If it is only "lending" the number with no agreement, both of you carry risk, and shop owners who take input tax credit on your invoice can be hurt if the supplier's returns do not match. A written agreement is the minimum (for example: that company operates the platform commercially and pays you a fee or a share, or you are its contractor). Ask a CA how to structure it. Do **not** charge GST under a number that is not truly the business that is supplying the service.

**To move later, in order:**
1. Register the new business (a proprietorship in your own name is the cheapest; see the next point) and get its bank account, PAN and, if needed, GSTIN.
2. Open a Razorpay account for it (new keys). Superadmin: Platform, Payments takes the new keys and webhook secret.
3. Put the new business details in Business details. From that moment new invoices show the new company.
4. Start a new invoice series for a new GSTIN (change the prefix; the counter is per financial year today, so this needs a small code change which I can make).
5. Tell every shop by a policy-change notice and email ("the service is now provided by X"), update Terms and Privacy to name the new company, and settle the prepaid SMS balances (money already paid is the old company's liability: either refund, or transfer by agreement).
6. Move the Google Play developer account, domain, SMS (DLT) registration and cloud accounts to the new owner.

**You may not need to "buy an agency".** A sole proprietorship costs nothing to create: PAN, a current or savings bank account, and (as business proof) a free Udyam registration are often enough. GST registration is free from the government and is generally required only above the turnover threshold for services (about Rs 20 lakh a year in most states) or in some interstate cases. Check with a CA whether you need it now. Until you are registered, **you must not charge GST at all.**

## 3. Question: shops without a GST number cannot join Razorpay?
That is not always true, but a GST number makes it easier. Razorpay generally accepts proprietorships and individuals with a PAN, a bank account and a business proof. For a restaurant, an FSSAI licence is compulsory for the food business, and Udyam or a Shop Act certificate are other common proofs. Confirm the current list on Razorpay's website; it changes.

How the app copes with shops that have no GST (the roughly 10%):
- Cash on delivery works with no payment account.
- A shop without a GSTIN gets "INVOICE" and no tax on its order invoices; with a GSTIN it gets "TAX INVOICE" with CGST and SGST.
- The platform's rent invoice charges GST only when the platform business has a GSTIN. Shops with a GSTIN can use it to claim input credit, which is why the 90% will check your invoice carefully.

## 4. What I changed today because of this
SMS top-up GST is now added only while the platform business has a GSTIN saved (the same rule as the rent invoice). With no GSTIN the owner pays exactly what he types and no GST is shown. Tests cover both cases.

## 5. Gaps, most serious first (what to build)
1. **SMS top-up document:** a numbered receipt or tax invoice PDF, emailed (same style as the rent invoice). Today there is none.
2. **Tax invoice details on platform invoices:** CGST/SGST or IGST split, place of supply (the shop's state), "reverse charge: no", the platform's PAN. Today only "GST @ 18%" is shown.
3. **Credit notes:** a numbered credit note when an issued invoice is cancelled, instead of only the VOID stamp.
4. **Receipt PDF for rent payments** (today the "payment received" mail is a table of values).
5. **Terms of Service and Privacy Policy:** real pages in the apps (they are plain words on the login screen), and a record of who accepted which version and when. Needed for customer data under India's data protection law, and for every shop and rider.
6. **For your accountant:** a monthly pack (platform sales register by GST rate and state, top-up and rent summaries, rider statements as CSV). The ledger and CSV export exist, but not in an accountant's layout.
7. **Rider papers:** an earnings statement per rider and a written rider agreement (who is the rider's employer or principal).

## 6. Agreements you need on paper (no software replaces these)
- Platform to shop (Terms): who the operator is, fees, refunds of the prepaid SMS balance, what happens when rent is unpaid (the app pauses the shop).
- Shop to rider: how riders are engaged and paid.
- The arrangement with the company whose GSTIN you use now (section 2).
- A privacy notice naming the company that holds customer data.
