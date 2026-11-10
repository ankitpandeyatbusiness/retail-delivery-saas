# Orders tab: phone test

Deploy the server first, then update the superadmin app. Use one test shop with a rider and a customer.

## 1. Attention
1. Place an order and do not accept it. After 5 minutes it shows in **Orders > Attention** as "Shop has not accepted". After 10 minutes you get a push; tapping it opens the order.
2. Accept a delivery order, mark it ready with no rider. After 10 minutes: "No rider yet". After 30 minutes: a push to you.
3. Cancel an online-paid order. If the refund has not gone back, it shows "Cancelled after payment, refund not done" at the top.
4. The chips show a count per reason. Tapping one filters the list. With nothing stuck it says "All clear".

## 2. Live
1. Orders > Live: "Running now", orders today, delivered, cancelled, sales today.
2. Each shop with running orders shows New / Kitchen / Ready / On the way and the oldest wait (red after 30 minutes). Tapping a shop opens its orders.

## 3. Refunds
1. Attention shows a "refunds not finished" card when one is pending or failed. It opens Refunds.
2. A failed refund shows its error and **Send again**. Done refunds are under "Done".

## 4. Owner told
1. From the superadmin, cancel an order with a reason. The shop owner gets "Order #N cancelled by the platform" with your reason.
2. Move an order one step. The owner gets "moved by the platform".

## 5. Order page and All list
1. An order that has a complaint shows a Complaint row; tapping it opens the complaint.
2. Orders > All: the Every type / Delivery / Pickup / Dine-in / Bulk chips filter the list.

## 6. Shop quality and repeat cancellers
1. Attention or Live > **Shop quality**: 7 / 30 / 90 days. A shop that crosses a limit says "Needs a talk" with the reason.
2. **Customers who cancel a lot**: needs a customer who cancelled or was not home 3 times. Tapping one opens him in his shop.

## 7. Order limits (gear icon in the Orders header)
1. Change "Shop has not accepted" from 5 to 15. Save. An order waiting 8 minutes leaves the Attention list.
2. "Use suggested numbers" puts the defaults back. A bad value (0) is refused.
3. Only the supreme admin can save; another admin can look.

## 8. Sales report and customers
1. Orders > chart icon: the funnel has Period and Shop. Pick a shop: the whole report is for that shop. In "By shop", tapping a row opens that shop.
2. "Customers of every shop" (also on the Live view): search by name or part of a phone, sort and shop in the funnel. Each row shows spent, orders, cancelled and not-home counts.
3. **Excel** on that screen downloads the list with the same filters. Phones are masked.
4. As the supreme admin: the funnel has "Phone numbers: Full numbers". The list and the Excel then show full numbers. Another admin does not see that option, and the server refuses it.
5. Each full-number look or download is in the audit log ("SEE FULL CUSTOMER PHONES", "DOWNLOAD CUSTOMERS WITH FULL PHONES").

## 9. Sales report: compare, lost sales, patterns, export, morning push
1. Sales / Orders / Average order show "Up 12% on before" or "Down 5% on before" (against the period of the same length just before). "By shop" has sort chips (Most sales, Most orders, Growing most, Falling most) and a badge per shop: Growing (up 20%+), Falling (down 30%+), Gone quiet, New. Tapping a shop opens its report.
2. "Sales lost": money on cancelled or not-delivered orders, split by who caused it, the shops losing most, and the amount refunded.
3. "When people order": orders by hour and weekday, delivery / pickup / dine-in, new against returning customers, and cash still with riders (tap a rider to open him).
4. "Your income this month" (all shops only): plans and wallet fees received, SMS margin, costs and net.
5. **Excel** downloads one file with a sheet each: Summary, By day, By shop, Best items, Sales lost, By hour, By weekday. **Share summary** opens WhatsApp or any app with a short text.
6. The morning push: after 8:00 India time, once a day: "Yesterday: N orders, Rs X", up or down on the day before, orders needing attention, refunds not finished. Tapping it opens the Sales report. Switch it off in the notification rules (admin_daily_summary).

## 10. Pictures full screen (superadmin app)
1. Tap a rider photo, a dish picture, a shop logo, a banner or collection picture, a complaint photo, a support chat picture, or the rider proof of delivery on an order: it opens full screen.
2. Pinch to zoom in and out, drag a zoomed picture, double tap to zoom in or back, swipe down or tap the cross to close.
3. A dish with several pictures, and complaint or support photos, show "1 / 3" with arrows to page through.

## 11. Live phone preview: the fixed customer screens
Open a shop > the phone preview > Full size > the Screens bar. These now follow the real customer screens (same order of parts, sizes and words; only the shop colours, font and logo change):
- Account: tiles, then SERVICES / REWARDS / PREFERENCES / HELP / MANAGE. A group or row appears only when its switch is on (Table booking, Bulk orders, Services, Points, Refer a friend in Dine-in settings).
- Book a table (day, guests, time, table map with Free / Your choice / Taken, deposit, your details) and My reservations (with the ticket and QR).
- Scan table, Table bill (call the waiter, rounds, tip, split the bill, pay online).
- Services (picture cards), the service form, My inquiries, and "Inquiry I sent".
- Bulk order, Bulk cart, the shop quote (Bulk order status), My bulk orders, My points, Refer a friend.
Turn the switch off for the shop: the page shows dimmed under a red note saying which switch to turn on.

## 0. References
1. Every shop has a short code (SAV for Savera). Check it in the order screen: an order shows as SAV-1042, not only #1042. The customer app and the shop owner app show the same reference.
2. Search (Home) and the Orders list find a document by its reference: SAV-1042 (order), SAV-T7 (SMS top-up), SAV-B12 (table bill), SAV-BK-XXXXXX (bulk order), SAV-TB-XXXXXX (table booking). The top result opens that exact document.
3. The order invoice says "Order Ref: SAV-1042" (its INV-1042 number is unchanged). The table bill, booking receipt and SMS top-up invoice print their reference too. The legal numbers SUB/..., TOP/..., CN/... are unchanged.
4. Old orders, top-ups and table bills got their references when the server started (nothing was renumbered).
