# Plans, wallet, coupons, refunds: phone test

Tick each line. "Expect" is what you should see. If something differs, note the test number and what you saw.

## 0. Before you start
- [ ] Backend deployed, OTA published for mobile AND superadmin, both apps closed and reopened once.
- [ ] Superadmin > Money > business settings: legal name, GSTIN, address, state are filled (needed for invoices and GST).
- [ ] Razorpay is in TEST mode on the server (test keys), so no real money moves.
- [ ] Superadmin > More > Plan defaults: Growth Rs 2,999, Pro Rs 4,999, GST 18. Month discounts: 3 = 5, 6 = 10, the rest 0. Save.
- [ ] Test shops: **A** on Partner, **B** on Growth, **C** on Pro, **D** in a free period, **E** a brand with 2 branches. Log in to the owner app as A, B, C in turn (or use 3 phones).

---

## 1. Plan defaults (superadmin)
| # | Do | Expect |
|---|---|---|
| 1.1 | More > Plan defaults, look at the month discounts | 3 months 5, 6 months 10, others 0 |
| 1.2 | Change Growth to 3,000, save, open a shop owner's Plan screen | Growth shows "Rs 3,000 + GST per month*". Change it back after |

## 2. Changing a plan from superadmin
| # | Do | Expect |
|---|---|---|
| 2.1 | Shop A > Plan > choose Growth > confirm | The plan changes at once. The shop card shows the Growth badge |
| 2.2 | On the owner phone of shop A | A push: "Your plan was changed", text "Partner to Growth. Changed by the Platform." Your email or name is NOT shown |
| 2.3 | In your superadmin alerts feed | The entry still says who changed it |
| 2.4 | Change the same shop back to Partner | Same kind of push, and the wallet and Partner rules come back |

## 3. The owner's Plan screen (log in as A)
| # | Do | Expect |
|---|---|---|
| 3.1 | Open Plan | Three cards: Partner, Growth, Pro. Prices end with `*`. At the very bottom, small plain text: "* All payments... are non-refundable..." |
| 3.2 | Tap Partner | Lists only what is included: your own online shop, shopname.vivyaan.co.in link, order timeline and rider call, dine-in QR tables, coupons, online payments, daily sales, tax invoices, languages, up to 2 riders. No "Not included" list anywhere |
| 3.3 | Tap Growth | "Everything in Partner, plus": live rider map, unlimited riders, up to 5 kitchen and waiter logins, Soundbox voice, services, loyalty, auto-accept, costs and profit |
| 3.4 | Tap Pro | "Everything in Growth, plus": run up to 3 shops from one account, custom domain, unlimited logins, bulk orders, analytics, push offers, daily push, full exports |
| 3.5 | Change the language to Hindi, reopen Plan | All lines, the footnote and the notes are in Hindi. Nothing in English except plan names |

## 4. Months and discount (Growth or Pro card open)
| # | Do | Expect |
|---|---|---|
| 4.1 | Look at the month chips | 1, 2, 3 · 5% off, 4, 5, 6 · 10% off |
| 4.2 | Pick Growth x 3 | Lines: "Growth plan for 3 months" Rs 8,997, "3 months discount 5%" minus Rs 450, GST 18%, You pay about Rs 10,086 (Rs 8,547 after discount + Rs 1,539 GST) |
| 4.3 | Pick Growth x 6 | 10% off on Rs 17,994. GST on the discounted amount |
| 4.4 | Pick x 4 | No discount line |
| 4.5 | Switch the language to Hindi | The lines and notes below the chips are in Hindi |

## 5. Paying a plan (test Razorpay)
| # | Do | Expect |
|---|---|---|
| 5.1 | A: Growth x 1 > pay with the test card or UPI | "Done". Plan shows Growth, ends in about 30 days. Home and side menu show "Growth, ends ... (N days left)" |
| 5.2 | Open Plan > Payments | The row "Growth × 1 · date" with the amount and **Invoice (PDF)** |
| 5.3 | Tap Invoice (PDF) | A PDF opens: invoice number, your company, the shop, Growth plan, GST split, total. It can be saved or shared |
| 5.4 | Tap Pay twice quickly on the pay screen | Only ONE payment is made and applied |
| 5.5 | Close the app right after paying, reopen | The plan is already applied (the server confirms it by itself) |
| 5.6 | Renew Growth again while it runs | The new months are added AFTER the current end date |
| 5.7 | Upgrade Growth to Pro with 20 days left | You pay only the difference for the 20 days (about Rs 1,333 + GST on defaults). Pro starts at once, the end date stays |
| 5.8 | Try to go from Pro to Growth | "A lower plan starts when your paid time ends." Nothing to pay. It is shown as scheduled, with a cancel option |
| 5.9 | Business settings empty (temporarily), pay, tap the invoice | "The invoice is not ready yet". After you fill the settings, tapping again makes it |

## 6. Partner wallet (log in as A on Partner)
| # | Do | Expect |
|---|---|---|
| 6.1 | Open Wallet | Balance, "Each completed order costs Rs 3 to Rs 15", the slab table is NOT shown |
| 6.2 | Add Rs 500 | "You pay Rs 590" (500 + 18% GST). After paying, the balance is Rs 500 |
| 6.3 | History | A "Top-up" row with **Open invoice (PDF)** |
| 6.4 | Tap Open invoice (PDF) | The tax invoice for Rs 500 + GST opens |
| 6.5 | Complete a Rs 280 order (customer app, then complete it) | Wallet drops by Rs 6. History shows "Order #..., Rs 280, fee Rs 6". "Fees this month" goes up |
| 6.6 | Cancel an order before completing | No fee |
| 6.7 | Let the balance get under 20% | A "wallet low" push. At zero: "wallet is finished" push, and new orders stop. Existing orders and refunds still work |
| 6.8 | Go into overdraft by up to about Rs 100 | Orders still come. The next top-up repays it |
| 6.9 | Open the same top-up payment twice quickly | The wallet is credited once |

## 7. Plan end, grace and pause
| # | Do | Expect |
|---|---|---|
| 7.1 | Superadmin: put shop B's plan end to 3 days from now | Owner gets reminders at 7, 3 and 1 days, once each |
| 7.2 | Let it end | "Plan ended" push, the Choose your plan screen, then the grace days (3) |
| 7.3 | After grace | The shop is paused for NEW orders. Orders in progress still finish. Customers see a gentle message |
| 7.4 | Pay a plan | The shop works again at once |
| 7.5 | Shop D (free period): superadmin "End the free period now" | The free period ends, the owner is asked to choose a plan |

## 8. Coupons
Setup: shop A on Partner, shop B on Growth with the plan ending in 5 days, shop C on Pro ending in 60 days.

| # | Do | Expect |
|---|---|---|
| 8.1 | Superadmin > More > Plan coupons > make: code PRO6, 20%, plan Pro, term 6 months, start today, end in 10 days, shops: all | "Coupon PRO6 made". A push window opens with three ready-made texts |
| 8.2 | In the list | PRO6, 20% off, Live. "Can use it now": A and B counted, C not (its plan runs past the coupon) |
| 8.3 | Send push with Text 1 | "Sent to 2 shops". Shops A and B get the push. C does not. If the owner's language is Hindi, the push is in Hindi |
| 8.4 | Owner A > Plan > tap Pro | A dashed card "PRO6 · 20% off · For 6 months · Valid till ..." |
| 8.5 | Tap the card | It shows "Applied", months switch to 6, the lines show "Coupon PRO6 20% off", total is lower than the 10% term discount (20% beats 10%, they are NOT added) |
| 8.6 | Tap the card again | The coupon is removed |
| 8.7 | Type PRO6 in the code box, Apply | Same as tapping the card |
| 8.8 | Type a wrong code | "That coupon code is not valid" |
| 8.9 | Pick Growth, then type PRO6 | "This coupon does not apply to this plan" |
| 8.10 | Pick Pro x 3, type PRO6 | "This coupon does not apply to this number of months" |
| 8.11 | Make a coupon of 5% and apply on 6 months | A note: the 6 month discount is already better, the coupon is not used and not counted |
| 8.12 | Pay with PRO6 (test Razorpay) | The amount equals the preview. In the superadmin list "Used 1" |
| 8.13 | The same shop tries PRO6 again | "This coupon is not available for your shop" |
| 8.14 | Owner C (Pro until 60 days) | No coupon card for C |
| 8.15 | Superadmin: Switch off PRO6 | Owners no longer see it, typing it is refused |
| 8.16 | Use limit 1 on a coupon, let one shop use it | The other shops can no longer use it |
| 8.17 | Plain (non-supreme) superadmin tries to make or send a coupon | Refused |

## 9. Upgrade tags and dialogs (look at each plan)
Turn Easy mode OFF in the side menu first, because Easy mode hides rows.
| # | Do | Expect |
|---|---|---|
| 9.1 | Owner A (Partner), open the side menu | GROWTH tags on Rewards and points, Costs and profit, Kitchen staff, Waiters, Services, Inquiries. PRO tags on Autopilot, Bulk orders, Business report, Branches, and on Download your data |
| 9.2 | Owner B (Growth) | Only PRO tags. No GROWTH tags |
| 9.3 | Owner C (Pro) | No tags at all. No Branches row. Every screen opens |
| 9.4 | A taps Costs and profit | A dialog: what it does ("Add what you spend... see what the shop really kept"), who it is for, "Available in Growth. Upgrade your plan to use it." Buttons: See plans, Not now |
| 9.5 | Tap See plans | The Plan screen opens. Not now: nothing happens |
| 9.6 | Check each locked row (Autopilot, Rewards, Report, Waiters, Services, Bulk, Branches) | Each dialog explains its own feature |
| 9.7 | A: Alerts settings | A note "Soundbox voice announces every new order" with a GROWTH tag. Tapping it opens the dialog |
| 9.8 | A: Delivery rules (rider rules) | A note for the live rider map. B and C do not see it |
| 9.9 | Customers screen | A and B see an Autopilot note with a PRO tag. C sees the real Autopilot shortcut |
| 9.10 | A: New message | The note for sending offers to customers (Pro). Riders can still be messaged |
| 9.11 | A: Download your data | A note: "Files below Pro leave out customer names, phones and addresses". Money exports work. C's files include customer details |
| 9.12 | Language Hindi | All dialogs, tags text and notes in Hindi |

## 10. Emergency refunds (superadmin, supreme admin; test mode)
Setup: shop B has a paid Growth plan from test Razorpay with 20 of 30 days unused. Shop A has a paid wallet top-up of Rs 500 (+ GST) and a Rs 200 free credit from "adjust".

| # | Do | Expect |
|---|---|---|
| 10.1 | Shop B > Plan > Emergency > Send money back | The screen lists the plan payment with Paid, Already refunded, Can still be refunded |
| 10.2 | Tap Refund on the payment | Amount prefilled with the unused share (about two thirds). A switch "End the plan now" is on. A reason box |
| 10.3 | Reason under 5 letters | The Send button stays disabled |
| 10.4 | Enter a reason, Send, confirm "Yes, send it" | "Refund sent". History shows Sent. The owner phone gets "A refund was sent". The plan ends: the owner sees Choose your plan |
| 10.5 | Open Money > ledger / GST register for the month | A negative row "Refund: plan payment" for that amount, dated today |
| 10.6 | Try to refund more than what is left | Refused: "more than is left to refund" |
| 10.7 | Double tap Send | Only one refund. History has one row |
| 10.8 | Shop A: Wallet card | "Paid for online (can go back)" Rs 500, not the Rs 200 free credit. "Goes to the shop, with GST" Rs 590 |
| 10.9 | Refund Rs 300 of wallet money | Rs 354 goes back (300 + 18%). The wallet balance falls by Rs 300 at once. The history shows Sent |
| 10.10 | Try Rs 600 | Refused: more than the wallet money that was paid for online |
| 10.11 | (Test only) make the payment partner refuse | The wallet balance is put back, history shows Failed with the reason |
| 10.12 | A plain superadmin opens the shop Plan screen | No way to refund (the server refuses) |
| 10.13 | Real Razorpay test dashboard | The refund appears on the original payment |

## 11. Terms
| # | Do | Expect |
|---|---|---|
| 11.1 | Superadmin > legal pages > Terms for Shop Owners | Sections: Plans and payments, Wallet and SMS balance, No refunds. No mention of rent, late fee or bills |
| 11.2 | Owner app > About Us > Terms | The new text, if you published it. If an older version was published, publish the new one |

## 12. Owner Shop settings map
| # | Do | Expect |
|---|---|---|
| 12.1 | Shop settings > Address (shop not pinned) | The row "Pin your shop on the map" |
| 12.2 | Tap it, search a place or use my location, confirm | The row becomes a small map with the pin and a circle. Caption "Delivers within X km of the pin". Street, city and pincode are filled in |
| 12.3 | Tap the map card | The full picker opens with the pin where it was. Moving it fills the address again |
| 12.4 | Save and reopen | The map shows the saved pin |

## 13. Money views after all this
| # | Do | Expect |
|---|---|---|
| 13.1 | Owner > Money > payments | A line "Your plan, extra shops and wallet" for plan and wallet payments. A refund shows as a minus line |
| 13.2 | Superadmin Money: ledger, GST register, month close | Plan, wallet and SMS payments appear. Refunds reduce the totals. Numbers agree with each other |
| 13.3 | Search for "rent" or "old bill" screens | They do not exist (old billing removed) |

## 14. Move existing shops to Pro (only when you are ready)
| # | Do | Expect |
|---|---|---|
| 14.1 | More > Move shops to plans > preview (dry run) | A list of who would move and who is skipped. Nothing changes |
| 14.2 | Run it | A backup is taken first. Shops are on Pro with 30 free days. It can be run twice safely and undone |

## 15. Safety checks
| # | Do | Expect |
|---|---|---|
| 15.1 | Pay, then check the same payment in two phones | Applied once |
| 15.2 | Change a shop's plan from superadmin while an owner is on the pay screen, then the owner pays | The payment is HELD for you (not applied blindly). You see an alert. Use the emergency refund if needed |
| 15.3 | Owner of shop A tries to open shop B's invoice link | Not found |

---
When something fails, send me: the test number, what you saw, a screenshot, and the shop name.
