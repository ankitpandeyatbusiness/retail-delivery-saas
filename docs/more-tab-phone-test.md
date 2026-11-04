# More tab and the moves: phone test

Nothing here was tried on a real phone yet. Go through it once, top to bottom.

## 1. More tab
1. Open **More**. Rows now: Alerts and rules, Platform controls, Records, Me, Appearance, App. Nothing about shops, orders or money is left.
2. **Needs attention** shows only when something is wrong: maintenance on, support waiting, alerts not read, last backup older than 2 days, a Platform health card that is not green.
3. On a backup or health item tap **Mark as handled**, write a note, check it leaves the list, then **Undo** inside 10 minutes.
4. Type in the search box (for example "backup", "dlt", "brands"). Screens, shops, orders and people are found. Clear it to see More again.

## 2. Moved rows (nothing deleted)
- **Shops tab**: top of the list has *Brands and branches* (with the count) and *Health, support and owners*. The second opens Shop health, Shops growth, Support requests, Messages to owners, Agreements.
- **Orders tab > Attention** (scroll to the bottom): *Services and booking* and *Live tracking*.
- **Money tab**: Shop money and GST register are there already (removed from More).
- **Home**: Platform health is there already (removed from More).
- Search for "growth", "agreements", "live tracking": each opens its screen.

## 3. Audit log and Alerts inbox
- Both now have a search box and a funnel (the same popup as the other lists).
- Audit log search takes several words in any order: an action, an address, a person, a shop, GET/PUT/POST, or a code like 403.
- Alerts inbox: search words in the title or text, and the funnel picks Unread only or one kind (orders, bills, SMS, payments, complaints, shops).

## 4. SMS and DLT setup (More > Alerts and rules)
Only the supreme admin can save or send a test; other admins can look.
1. Open it: the top card says *Not ready* until the auth key, sender ID and entity ID are in.
2. Paste the MSG91 auth key (it is kept encrypted and never shown again), the sender ID and the entity ID. **Save**.
3. Paste the template ID of each of the 12 texts (the text to register is shown on each row, the same list as `docs/dlt-templates-to-register.md`).
4. A value set on the server (.env) shows as *Set on the server* and cannot be changed here. The server value always wins.
5. Type your mobile number and **Send test**: a real login OTP text arrives. The last result stays under the button.
6. Then Money > SMS balance > *Ask the provider now* works with the saved key too.

## 5. Safe to know
- *Mark as handled* never changes the thing itself. After 10 minutes it cannot be taken back.
- Maintenance already asks you to confirm before it pauses every shop.
- The supreme admin can never be revoked from Team (already enforced).

## 6. Export centre (More > Records > Export data)
Not tried on a phone yet.
1. The list has 13 exports in groups: People (customers, riders), Orders and money (orders, rent invoices, customer payments, refunds, complaints), SMS (top-ups, sent), Shop data (menu, shops), Platform (your expenses, audit log).
2. Tap one. Pick the **shops** (all, a brand's branches, or tick several), the **period** (quick buttons or two dates), **how much detail**:
   - Quick = the few columns for every day; Standard = the working detail; Everything = all columns, plus a second sheet (a row per dish for orders, bill lines for invoices).
   - "See the N columns" lists what each level holds.
3. The funnel holds the filters of that export (status, type, paid by, ...). The card under it says "1,240 rows" before you download; over 20,000 it warns and the file holds the first 20,000 (narrow the period or shops).
4. Choose Excel or CSV and **Download**. Every Excel file starts with a **Summary** sheet (what you chose, rows, who made it, when).
5. **Save this choice** keeps it on this phone; it shows at the top of Export data and opens the screen already filled in.
6. Phones are hidden in the middle. The supreme admin sees a "Full phone numbers" switch; using it is written in the Audit log.

## 7. Planned maintenance (More > Maintenance > Plan a maintenance)
Not tried on a phone yet.
1. Choose every shop, chosen shops or a brand; the start (today / tomorrow / date and time); how long (30 min, 1 h, 2 h, 4 h, or until you switch it off); a message; who is told (owners, cooks and waiters, riders, customers).
2. **Plan it**: people get a push and an inbox message right away; the shop apps show an orange banner with the time. Warnings follow 24 hours, 1 hour and 15 minutes before (a warning that is already past when you plan is skipped).
3. At the start time the apps pause by themselves (same "Back soon" screen as today; up to 30 seconds late). At the end time they open again. With "until I switch it off" they stay paused until you end it from the list.
4. The list shows planned, running and past ones. **Cancel it** before it starts tells people it is off; **End it now** opens the shops.
5. A pause you set by hand on a shop is never switched off by a plan that ends.
6. Customers get a push, no SMS (SMS cost money).

## 8. People exports and the behaviour summary
Not tried on a phone yet.
- **Customers, Everything level** has a column **Behaviour in words**, for example: "Loyal customer: 12 orders delivered, ₹4,800 spent in all. Orders about once a week. Usually orders around 8:30 PM (dinner time), most often on Fridays. Likes Paneer Tikka (5 times), Naan. Spends about ₹400 an order, more than most customers of this shop. Prefers home delivery and paying by UPI. Last order 3 days ago. A thank-you offer would keep them." Standard shows only the **Customer type** (New, Regular, Loyal, Occasional, Slipping away, Lapsed, Never ordered, Blocked); Everything also gives orders-every-N-days, spend compared with the shop, and more or less active than last month.
- **Shop owners**: shop, owner, rent state, orders and sales (30 days), unpaid bills, SMS balance, rating, how fast the shop accepts, last login. Everything adds a sentence ("Gets about 14 orders a day, busiest around 8 PM. Accepts an order in about 3 min (fast). Rent is paid up. Owner last logged in 2 days ago. Looks healthy.") and a to-do hint. Filters: rent, shop open or suspended, orders in 30 days, owner last seen.
- **Brand owners and branch managers**: one row per brand owner and per branch manager, with the branches they run, 30 day orders and sales, unpaid bills, last login, and a sentence. Filters: role, has unpaid bills.
- **Cooks and waiters**: status, on duty now, last active, holidays; for cooks the orders they handled in 30 days and the average cooking time compared with the other cooks, problems they told the owner. Everything adds a sentence. Filters: role, active or paused, on duty now.
- Alerts are not listed in More any more: the bell in the header shows them.
