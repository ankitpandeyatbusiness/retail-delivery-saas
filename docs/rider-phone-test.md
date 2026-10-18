# Rider panel: phone test (about 30 minutes)

You need: the owner phone (or the owner app), one rider phone with a rider number, one customer phone, the shop with live tracking on.
Tick each line. Write down anything that looks wrong or feels slow (a screenshot is best) and send it to me.

## A. Setup (owner phone)
- [ ] Delivery rules > "How do you pay your riders?": choose "A fixed amount for each delivery", ₹30. Save.
- [ ] Delivery rules > "Most cash one rider may hold": ₹500. Save.
- [ ] Riders: your test rider is listed and shows "₹30 for each delivery".

## B. A normal delivery (all three phones)
- [ ] Rider phone: sign in. Home opens with "Off duty". Tap **Start duty**. The "keep the app working" guide appears once.
- [ ] Customer phone: place a **cash on delivery** order of about ₹250 for an address 1 to 3 km away.
- [ ] Owner phone: accept the order.
- [ ] Rider phone: a **new order card** appears (sound/vibration too?) with ₹30, the distance and "Collect ₹250 cash". Tap **Accept**.
- [ ] The delivery page opens: step 1 "Collect from the shop". The big button is greyed until the shop starts preparing. Owner: mark preparing.
- [ ] Rider: **I have collected the order**. Customer phone shows the bike on the map.
- [ ] Rider: step 2 shows the customer name and address. **Navigate** opens Google Maps. **Call** dials the customer. Tap **I have arrived**.
- [ ] Rider: step 3. The customer gives the PIN. **I collected ₹250 · Deliver**. Enter the PIN.
- [ ] If you are far from the pin you get "You seem far from the customer": tap **Deliver anyway**.
- [ ] "Delivered!" screen shows "You earned ₹30". Home shows 1 delivery today.
- [ ] Money tab: "Cash with you ₹250", a collected line, earnings ₹30.

## C. Paying by QR at the door
- [ ] Place another cash order, accept, collect, arrive.
- [ ] Rider: **Customer will pay online**. A QR for the exact amount appears.
- [ ] Customer scans and pays. The rider's screen turns to "Payment received" by itself. The banner now says "Paid at the door", the cash to collect is ₹0.
- [ ] Rider: Deliver. Cash on the Money tab did **not** go up.

## D. Cash limit
- [ ] Owner: Rider page > Cash received: leave the rider holding more than ₹500 (do not record a handover yet).
- [ ] Rider Home shows "Give cash to the shop to get new orders". Place and accept a new order: the rider gets **no** offer.
- [ ] Owner records the handover. Place an order again: the offer comes.

## E. Problems and safety
- [ ] Rider: on a delivery, **I need help** > tell the shop. Owner phone gets a push "Rider needs help" with his name and number. Tapping it opens the rider.
- [ ] Rider: **Problem** > "The customer is not answering". Owner is told.
- [ ] Rider: before collecting, **I cannot do this delivery**. The order goes back to other riders (or to the owner).
- [ ] Switch the rider phone to flight mode on a delivery: the **No network** banner appears. Switch it back on: it goes away, the next tap works.
- [ ] Sign in with the same rider number on a second phone: the first phone is signed out.

## F. After delivery
- [ ] Customer phone: on the delivered order tap **I did not get this order**, confirm. Owner opens the complaint: "What we know about the delivery" shows the rider, the PIN, the distance, and the cash. Owner decides and picks "Was the rider at fault?".
- [ ] Owner: Rider page > Pay: "Record a payment" (turn on "Record what you pay riders" first). The rider's Money tab shows it.

## G. Battery and background
- [ ] Rider on a delivery: lock the screen for 5 minutes, walk or ride. The customer still sees the bike move.
- [ ] Close the shop in the owner's hours, wait 30 minutes with the rider idle on duty: the rider is put off duty with a notification.
