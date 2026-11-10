# Money tab: phone test (updated 2026-11-10 for plans)

Deploy the server first, then update the superadmin app. Plan and wallet money checks are also in `docs/plans-phone-test.md` (sections 13, 21 and 22).

## 1. The top of the Money tab
1. Cards: Collected this month, **Plans ending in 30 days** (the paid Growth and Pro plans that end in the next 30 days, at their own price, "if renewed"), Net this month (or Loss). Each says up or down against last month where it can. Tap one to open its screen.
2. "Your profit": three cards, This week, This month, This year (financial year), each with the one before. A loss reads "Loss this ..." in red. Tapping one opens Profit and loss.

## 2. Needs attention
1. Rows appear only when true: refunds that failed, Razorpay events that failed, money received that matches no record, SMS top-ups paid but not credited, SMS wallets running low. Red rows are the serious ones.
2. Nothing wrong: one green "All clear" row.

## 3. This month
1. Money > This month (or tap Collected). Use the arrows to go to earlier months.
2. Net, plans and fees received, SMS margin, costs, GST on documents issued, and the next 30 days (current month only): the plans that end, if renewed, against the average costs.
3. **Download** gives one Excel: Summary, documents issued, SMS top-ups, GST register, Expenses. Open it in Excel and check the documents carry shop codes and the refunds are minus rows.

## 4. Profit and loss
1. Weekly (4, 8 or 13 weeks, Monday to Sunday), Monthly (3, 6 or 12 months), Yearly (financial years, 1 April to 31 March). Charts and the list follow the choice.
2. A wallet top-up is cash collected, but income only grows as its per-order fees are used. A refund or a lost dispute lowers income.

## 5. Close the month and settings
1. Close the month: Download for my CA, GST register, Shop money (the Vivyaan yes/no).
2. Settings: one row "Money settings" holding GST, Cancel and refund rules, Business details, My Razorpay, SMS prices.

## 6. Morning push
1. After 8:00 the daily push says what was collected yesterday and how many money problems need a look.
2. At 10:00 one alert if a held plan payment or a bank dispute is still waiting.

## 7. SMS balance at the provider
1. Money > Profit > SMS balance (also in Money settings). Press **Ask the provider now**: it shows what the provider answered. If the number looks like SMS credits instead of rupees, switch the unit and ask again.
2. **I added money**: type the balance you see on the provider dashboard. Without a provider answer the screen shows an estimate: that balance minus what the SMS sent since cost you.
3. Set the two lines. Below the low line you get a push once. Below the reserve you get a critical alert and shop messages pause; login OTPs and your own alerts always go.
4. Money > Needs attention shows a red row while the balance is low or almost empty, and the 8:00 summary counts it.
