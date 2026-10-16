# Owner panel: what to check on the phone

You stay in the owner (admin) panel the whole time. Tick each line. If a line fails, note the screen and what you saw.

## Before you start
1. Backend: stop it and start again (`node src/server/server.js` in `backend/`), so the new routes are live.
2. Phone: `cd mobile && npx expo run:android` (keep Metro running). Log in with the owner phone (ends 6498).
3. Tabs at the bottom: **Home · Orders · Menu · Riders · Money**. Tap the **hamburger (three lines, top left)** for the side menu with everything else.
4. Items marked **(order)** need at least one order in the shop. Orders can only come from a customer, so for these either ask me to make test orders from the command line, or skip them for now.

---

## Round 2 (new)
- [ ] Bottom bar looks like the customer app: a rounded highlight slides under the tab you tap; pages slide smoothly.
- [ ] Top bar: hamburger, then your shop logo and name (logo visible). Tapping the logo does nothing. Hamburger opens the side menu from the left; no dark layer over the page; tap beside it or press Back to close.
- [ ] Open any bottom sheet (Busy mode, Add a rider, Pause orders): it slides up with no dark shadow over the screen.
- [ ] Bell → Messages for you: opening it marks everything read (badge goes to 0). **Clear all** empties the list.
- [ ] Menu → **See the customer app**: the customer app opens, with a **Back to owner panel** button. Add an item to the cart and press Place order: it says owners cannot order from their own number.
- [ ] Money → Monthly bill → **Pay now** (or SMS balance → choose an amount → Pay): a **Payment options** page with PhonePe / Google Pay / Paytm / Other UPI app / Card / QR. (Only pay if you want to; backing out is fine.)
- [ ] Money → **Transactions and bills**: year chips, months with in/out/kept; tap a month: entries; tap a monthly bill: its PDF opens; **Download** shares a spreadsheet.

## Round 3 (new)
- [ ] Every screen that loads shows grey shapes with a light sweep, not a spinning circle (open Menu, Riders, Money, a Customer, Complaints, Delivery area...).
- [ ] Hamburger: the side menu starts BELOW the status bar (you can see the clock and battery above it) and ends above the phone's bottom bar.
- [ ] Side menu, Your app: the **System / Light / Dark** switch changes the colours.
- [ ] Your logo shows in the top bar and at the top of the side menu.
- [ ] Menu, **See the customer app** slides in from the right like a normal page. **Back to owner panel** (or Android Back on the customer Home) slides it out to the right.

## Help and support (new)
Owner app:
- [ ] Side menu → **Help and support**: a card "We are here to help" (empty buttons until the superadmin fills the contact details), **Ask for help**, Open / Solved chips.
- [ ] **Ask for help**: choose a topic, write a title and a message, add a screenshot, **Send request**. You land on the request with your message on the right.
- [ ] When the superadmin replies (superadmin app), you get a message in the bell and a push; the request shows a red dot; opening it shows the reply on the left.
- [ ] Reply from the owner app, then **Mark solved**; a "How was our help?" star box appears; rate it.
- [ ] Even with rent unpaid (or the panel paused) you can still open Help and support and send a request.
Superadmin app:
- [ ] More → **Support requests** (a red "n waiting" badge and a line on Home). Open one: you see the shop and the owner (tap the owner to call).
- [ ] Send a reply; use a saved reply chip; add a picture; **Send and solve**.
- [ ] Switch to **Private note**, write a note: the owner app must NOT show it.
- [ ] Change priority to Urgent: it shows on the list.
- [ ] Top right button → **Contact details**: fill phone, WhatsApp, email, hours; the owner app card shows Call / WhatsApp / Email buttons.

## Email, report and monthly report (new)
- [ ] An owner without an email sees the **Add your email** sheet; typing an email sends a code (in a test setup the sheet also prints the code); the right code closes the sheet. Profile → Email → Change works the same way.
- [ ] Menu → Messages → New message: there is no "send by email" switch any more.
- [ ] Home → **See how your shop is growing** (or Menu → Money → Business report): charts for 7 days / 30 days / 3 months / last month, "What the app brought you", tips with buttons, best food, best rider, a positive line, **Share my progress**.
- [ ] Shop settings → Alerts and reports: switch **Monthly report** off, then **Reset to recommended** brings both switches back on.
- [ ] Superadmin app → a shop → **Progress report**; More → **Owner report settings** (change the commission, press Reset to recommended).
- [ ] On the 1st (or when you ask me to run it once), the owner gets the notification "Your <month> report is ready" and an email with a PDF.

## Billing papers, settlement sheet, agreements and Switch (new)
- [ ] Restart the backend (new setting: SUPREME_ADMIN_PHONE in backend/.env, default 8318538918). Log in to the superadmin app with that number and with a second superadmin (add one in More, Superadmin team).
- [ ] The second superadmin can open the settlement sheet, GST register, Companies and Agreements but cannot change anything (a clear message appears).
- [ ] Money, Business details: fill legal name, address, GST number, PAN, state, invoice prefix, "Powered by" name and contact number. Save.
- [ ] Owner app, SMS balance: type 200, below it you see "You pay 236 ... 18% GST 36" (only with a GST number saved). After paying, History shows "Open invoice (PDF)".
- [ ] Owner app, Money, Monthly bill: a cancelled bill shows "Credit note (PDF)".
- [ ] Shop settings (owner) and the shop form (superadmin): the State field; wrong text is refused.
- [ ] More, GST register: pick a month, see the bills, top-up invoices and credit notes with CGST/SGST/IGST; Download Excel.
- [ ] A shop pays (or mark a bill paid in Money, with "received by"): a row appears on More, Settlement sheet and the supreme admin gets a notification. Open the row: timeline. "Record a payment", "Set off against another row", "Add shared cost". The second superadmin can only press "I have paid".
- [ ] Shop detail: "Who brought this shop" (supreme admin chooses), then pay again and see the ratio (50/50 or 70/30).
- [ ] More, Agreements and terms: open a document, "Edit draft", fill the [blanks], "Send new version". Then Shop detail: "Mark as handed over". On the owner phone open the app, close it for 30 minutes, open it again: the full-screen agree screen appears and cannot be closed. Same for a rider and for the second superadmin.
- [ ] Customer app: login screen and Account show "Terms and privacy" and "Powered by ... Contact" (the Contact button calls the number).
- [ ] More, Companies and Switch: "Save the current company", add your agency with its Razorpay keys, press "Switch to this company": read the checklist, switch. New bills show the new company and prefix; the sheet shows nothing to settle.

## Customers, Remind and Autopilot (new)
- [ ] Menu, Customers: chips Everyone / Slipping / Lost / New / Regular / Loyal / VIP with numbers. Slipping and Lost rows have a **Remind** button.
- [ ] Open a customer who has ordered: the card **How he orders** shows his tag, usual hour, favourite food. **Remind him** shows a pre-filled friendly message you can edit; **Send reminder** puts it in his app inbox and sends a notification.
- [ ] Remind the same customer again straight away: it says to wait (3 days between reminders). A customer who ordered today, or turned offers off, cannot be reminded.
- [ ] Menu, **Autopilot**: nothing is on at first. **Turn on recommended** switches on win-back, welcome, thank you, daily summary and Monday digest.
- [ ] Change language (English / Hinglish / Hindi), how often (Gentle / Normal / Pushy), the offer, quiet hours. Each change is saved at once. **Reset to recommended** brings them all back.
- [ ] **See and edit the messages**: tap one, write your own wording, save; then **Use the app's messages again**.
- [ ] After a day or two: "Last 30 days" on the Autopilot screen shows messages sent and customers who came back. At your summary time you get "Today: ... from N orders".
- [ ] Superadmin app: More, **Shops growth** (top, growing, slowing); a shop, **Autopilot** (stop it for that shop); More, Owner report settings, **Autopilot reminders** kill switch.

## Phase 1: Home, Orders, Pause
**Home**
- [ ] Shows today's sales, orders, a bar chart by hour, riders, SMS balance. No red error box.
- [ ] Pull down: it refreshes.
- [ ] Top bar says **Open**. Tap it: sheet with 30 minutes / 1 hour / 2 hours / until tomorrow morning / until I start again.
- [ ] Choose **30 minutes**: top bar says "Paused until HH:MM". Open it again and press resume: it says **Open**.

**Orders** (order)
- [ ] Chips (Active, New, ...) show counts. Search by order number works.
- [ ] A new order shows **Accept** and **Reject** right on the card. Accept moves it to the next step.
- [ ] Reject asks for a reason; "Other" needs typed text (3+ letters).
- [ ] Tap an order: items, bill, customer call/WhatsApp/map, rider card, timeline.
- [ ] Delivered order: **Invoice** opens a PDF.

## Phase 2: Menu
- [ ] **Menu tab** lists your items grouped by category, with pictures.
- [ ] Search an item name: list narrows. Tap a category chip: only that category.
- [ ] Switch **In stock** off on an item: sheet asks *For today / 1 hour / 2 hours / Until I switch it on*. Pick **1 hour**: row shows "Back at HH:MM". Switch on again: normal.
- [ ] **Add item**: fill kind, name, price, veg/non-veg, add a **photo** (picture shows after upload), Save. It appears in the list. Open it, change the price, Save: list shows the new price.
- [ ] In the item: add a **choice** (e.g. "Choose size": Small ₹0, Large ₹30). Save, reopen: it is still there.
- [ ] Item → **Daily stock**: switch on, set 5, Save stock. Back in the list it says "5 left", the **+ / −** buttons change it.
- [ ] **Remove this item**: it disappears from the list.
- [ ] Menu → **Categories**: arrows reorder, switch hides a category, tap one to change name/picture/hours (e.g. 07:00-11:00). Add a category.
- [ ] Menu → **Collections**: add one, choose items, set dates, save.
- [ ] (Optional, in the app as a customer view later) hidden category / sold-out item no longer appears.

## Phase 3: Riders
- [ ] **Riders tab**: Online count and "Cash with riders".
- [ ] **Add a rider** with a 10-digit mobile number (use a spare number): he appears in the list. Switch **Can deliver** off/on.
- [ ] Tap the rider: Call / WhatsApp buttons, cash card, history.
- [ ] (order, rider with cash) **Cash received**: amount cannot exceed what he owes. **Correction** needs a reason.
- [ ] **Live map**: opens a map; says "No rider is sharing his location" if nobody is online.
- [ ] **Performance**: 7 / 30 days / this month switch the numbers.
- [ ] **Rules**: change "orders one rider can carry" to 2, Save; open Rules again: it shows 2.
- [ ] Remove the test rider.

## Phase 4: Money
- [ ] **Money tab**: period chips (Today, 7 days, 30 days, This month) change the sales number.
- [ ] **Download Excel**: the phone's share sheet opens; open it in Sheets/Excel: sheets *Orders, Sales by day, Items sold*. (order)
- [ ] **Online money** card → screen with Money / Refunds / Chargebacks tabs (empty lists are fine).
- [ ] **SMS balance** → shows balance; pick a pack → **Pay by UPI** shows a QR (do NOT pay unless you want to top up).
- [ ] **Monthly bill** → shows what is due, this month's orders, your bills. **Open bill (PDF)** opens a PDF.

## Phase 5: Shop hub, customers and offers
- [ ] Menu → **Customers**: list; search by name or phone; open one: stats, edit name/notes, Save.
- [ ] Menu → **Complaints** (needs a complaint): open one, reply, decide. Empty list is fine.
- [ ] Menu → **Reviews**: Food / Delivery tabs, star filter (empty is fine).
- [ ] Menu → **Messages**: **New message** → write title + text → Send. The app asks to confirm. It appears under *Sent* with "x/y delivered". (This really notifies your customers: use a short test text, or skip.)
- [ ] Menu → **Coupons**: add `TEST10` (10 percent, highest ₹50), Save, switch off, open and edit.
- [ ] Menu → **Banners**: add one with a picture and the coupon code, move it with the arrows, switch off, delete.

## Phase 6: Settings
- [ ] Menu → **Opening hours**: switch "Use opening hours" on, set Monday 09:00 to 22:00, add a holiday, Save. Reopen: same values.
- [ ] Menu → **Delivery area and fees**: tap the pin → map opens → **Use my position** → **Set shop here**. Set distance 5 km, fee type **Same for all** ₹30, packaging ₹5, add a tip ₹10. Save. Reopen: values are kept.
- [ ] Menu → **Shop settings**: change nothing risky; Save works.
- [ ] Menu → **Busy mode**: +15 min for 1 hour. The hub row says "On: +15 min until ...". Switch it off.
- [ ] Menu → **Closing report**: Today / Yesterday; **Share this report** opens the share sheet.
- [ ] Menu → **Activity log**: lists your changes above in plain words ("Changed shop settings").
- [ ] **Bell** (top right of any tab) opens "Messages for you". Badge shows unread count.
- [ ] Put the settings back to what you want your shop to use (hours, fee).

## Soundbox (already tested earlier; only re-check this new switch)
- [ ] Menu → **Soundbox** → "Keep Soundbox always ready" is **OFF** by default. Turn it ON: a permanent "Soundbox is on" notification appears. Turn it OFF: it disappears.
- [ ] (order) New order: phone rings with the bell + "New order received", and reads the order.

---

## If something fails
- Red or "Could not load" box: pull down to retry. If it stays, tell me the screen name.
- "Locked while rent is unpaid": menu and settings close when rent is overdue; pay on Money → Monthly bill.
- Backend errors: look at the backend terminal window while you tap, and send me the last red lines.
