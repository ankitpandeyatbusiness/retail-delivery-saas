# Money tab: phone test

Deploy the server first (it fills in shop codes and references when it starts), then update the superadmin app.

## 1. The top of the Money tab
1. Four cards: Collected this month, Overdue, Expected next 30 days (an estimate), Net this month (or Loss). Each says up or down against last month. Tap one to open its screen.

## 2. Needs attention
1. With a bill overdue, the list shows "Overdue rent bills" with the count and amount. Tapping it opens Rent invoices on the overdue ones.
2. Other rows appear only when true: shops to close, refunds that failed, Razorpay events that failed, money received for no bill, SMS top-ups paid but not credited, bills marked paid without a date, SMS wallets running low. Red rows first.
3. Nothing wrong: one green "All clear" row.

## 3. This month
1. Money > This month (or tap Collected). Use the arrows to go to earlier months.
2. Net, rent billed and collected, SMS margin, costs, GST on bills issued, what is still owed (tap to open Who owes you), the next 30 days (current month only).
3. **Download** gives one Excel: Summary, Bills issued, SMS top-ups, GST register, Expenses. Open it in Excel and check the bills carry shop codes.

## 4. Who owes you: notes and promises
1. On a shop that owes rent: **Add note**. Write what the shop said and pick the promised day (today, tomorrow, 3 days, a week, none).
2. The promise shows under the shop ("Promise: ... · date"). A later note replaces it. "He paid" or "Did not pay" closes it.
3. On the promised day (after 8:00) you get a push "Shop X promised to pay". A shop that has paid since is closed quietly. Only you see these notes.

## 5. Close the month and settings
1. Close the month: Download for my CA, GST register, Shop money (the Vivyaan yes/no).
2. Settings: one row "Money settings" holding Billing rules, GST, Cancel and refund rules, Business details, My Razorpay, SMS prices. Nothing was removed.

## 6. Morning push
1. After 8:00 the daily push also says: rent and top-ups collected yesterday, rent overdue, and how many money problems need a look.

## 7. SMS balance at the provider
1. Money > Profit > SMS balance (also in Money settings). Press **Ask the provider now**: it shows what the provider answered. If the number looks like SMS credits instead of rupees, switch the unit to SMS credits and ask again.
2. **I added money**: type the balance you see on the provider dashboard. Without a provider answer the screen shows an estimate: that balance minus what the SMS sent since cost you.
3. Set the two lines. Below the low line you get a push once. Below the reserve you get a critical alert and shop messages (order, bill, shop alerts) pause; login OTPs and your own alerts always go. A shop with its own provider account is never paused. The switch can turn the pause off.
4. Money > Needs attention shows a red row while the balance is low or almost empty, and the 8:00 summary counts it.
