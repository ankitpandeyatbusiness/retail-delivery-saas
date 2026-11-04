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
