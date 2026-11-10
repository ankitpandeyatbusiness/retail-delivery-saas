# Bulk orders + Services: end-to-end test cases (3 phones)

How to read this: every step says **what to do**, then **Expected:** what you should see or hear. Each step has a serial number (like `E1-07`). If something is different, tell me the number and what happened.

**Your three panels (phones)**
- **Customer panel** = Phone 1 (a customer login, not the owner's number)
- **Admin panel** = Phone 2 (the shop owner)
- **Cook panel** = Phone 3. In the delivery stories you log this phone out and log in as the **Rider panel** when told.

**Setup, do once (about 15 minutes)**
1. Superadmin app: open the test shop → App features → switch **Services** ON and **Bulk orders** ON. Shop → Payments → Razorpay **TEST keys** saved and the test passes.
2. Admin panel: menu has Dal ₹100, Paneer ₹200, Rice ₹60 (one dish with Half/Full options). Bulk orders → Settings → tap **Use recommended settings**, then set **notice hours = 1**, Pickup and Delivery ON, **Take bulk orders** ON. On the dishes set a **bulk price** lower than the normal price.
3. Admin panel: Staff → add a **cook** (Kitchen ON) and a **rider** (put online). Alerts screen: *Bulk orders* and *Kitchen problems* have Slider and Sound ON.
4. Cook panel: log in as the cook, switch to **On duty**. Expected: four tabs **To make · By dish · Bulk · Ready**. No Bulk tab means an old build: install the latest first.
5. Customer panel: log in, and save one address.
6. Use only Razorpay **test** money.

What "the admin hears it" means in every story: the **Soundbox voice** (English, then Hindi), the **slider** at the bottom with **no timer bar** and a **View** button. It stays until you close it.

---

## E1. Pickup bulk order: request, quote, advance, cooking, balance, invoice

**E1-01** Open the **Customer panel** → Account → **Bulk order**.
Expected: the full menu with a counter on every dish. Dishes with Half/Full show their choices.

**E1-02** Order a bulk with chosen options: add Dal ×100 and Paneer ×20, choose Half/Full where offered, select **Pickup**, tomorrow, 1:00 pm.
Expected: the price changes live as you add dishes; dishes with a bulk price show the lower price. Your name and phone are already filled in.

**E1-03** Before sending, try a tiny order (Rice ×2 only).
Expected: a clear message about the minimum order amount; it does not send.

**E1-04** Go back to the real order and tap **Ask the shop for a quote**.
Expected: "Sent". The order appears under **My bulk orders** as *Waiting for the shop's quote* with a code like B7K2QX.

**E1-05** Now open the **Admin panel**.
Expected: you hear the **Soundbox voice** along with the **slider** "new bulk order request". The slider has **no timer bar** and has a **View** button. It stays on screen until you close it.

**E1-06** On the Admin panel tap **View** on the slider.
Expected: that exact bulk order opens, showing the customer's dishes, quantities, choices, day and time.

**E1-07** Change one unit price, add a short note, tap **Send quote**.
Expected: the order now says *Quote sent*.

**E1-08** Open the **Customer panel**. A notification arrives: "Your quote is ready". Tap it.
Expected: the bulk order page opens (not a blank page, not "order not found"). It shows the lines, the total, the **advance (50%)**, the **balance** and the refund rule ("cancel at least 18 hours before…").

**E1-09** Tap **Ask for a change**, write "please make Paneer 15", send.
Expected: on the **Admin panel** you hear the Soundbox and see a slider; tapping View opens the order showing the change request.

**E1-10** On the Admin panel edit the quote (Paneer 15) and send it again.
Expected: the Customer panel gets a notification and shows the new quote.

**E1-11** On the Customer panel tap **Accept and pay ₹… now** and pay with Razorpay TEST UPI/card.
Expected: you return to the order and it says **Confirmed** with the advance paid.

**E1-12** Open the **Admin panel** (right after paying).
Expected: Soundbox voice and slider "advance paid, order confirmed" with a **View** button, no timer. View opens the order.

**E1-13** Open the **Cook panel** (right after paying).
Expected: you hear a **loud alert with the voice**: "New bulk order. Wanted on <the day> at 1:00 pm. Pickup. 100 Dal, 15 Paneer", and a push notification. Open the **Bulk** tab: the order is there with a **BULK ORDER · code** badge, "Wanted on …" and the dishes with their choices. It is **not** in *To make* yet (the day is more than 24 hours away; if your time was inside 24 hours it is in To make at the top, see E5).

**E1-14** On the Cook panel leave the alert alone for about a minute.
Expected: the ringing stops by itself.

**E1-15** Open the **Customer panel** → Orders tab.
Expected: one card with a **Bulk** label, its status, dishes, total and a **View** button. There is **no second** "Order #…" card for the same order. Tap the chip **Bulk Order**: only bulk orders are listed.

**E1-16** On the Cook panel open the order in the **Bulk** tab and tap **Start cooking**.
Expected: the card changes to *Cooking*.

**E1-17** Open the **Customer panel**.
Expected: status **Being made** and a push "The shop is making your order".

**E1-18** Open the **Admin panel**.
Expected: the order already says *Preparing*. You did not tap anything.

**E1-19** On the Cook panel tap **Ready**.
Expected: the card says *Ready*.

**E1-20** Open the **Customer panel**.
Expected: status **Ready** and a push "ready, collect it at the time you chose". The page says the balance is paid at the handover.

**E1-21** On the Customer panel tap **Pay the balance … now** and pay with TEST money.
Expected: the order shows the balance as paid online.

**E1-22** Open the **Admin panel**.
Expected: Soundbox voice and slider "balance paid"; the order shows *balance paid online*.

**E1-23** On the Admin panel tap **Handed over / Delivered**.
Expected: the Customer panel gets a push; status **Delivered**, then **Completed** a moment later.

**E1-24** Open the **Customer panel**.
Expected: **Completed**, with **View** and **Save** buttons for the invoice.

**E1-25** Tap **View** on the invoice.
Expected: an invoice with the bulk order code, the quote lines, GST (if the shop has GST on), the advance and the balance.

**E1-26** Go to Orders. Look at the bulk order's card.
Expected: the button now says **Order again** (not View).

**E1-27** Tap **Order again**.
Expected: the bulk menu opens with the same dishes, choices and quantities already filled. Day, time and address are asked again. A dish the shop no longer sells is left out with a short message.

---

## E2. Delivery bulk order with a rider (cash balance and live tracking)

**Important for this story:** choose a delivery time **less than 4 hours from now**. The rider is only asked when the food is packed AND the time is within 4 hours (if you assign a rider by hand from the Admin panel, he gets "Bulk order is packed" at any time). Switch the rider **on duty** first, and keep the shop open (a closed or paused shop switches riders off, see E17).

**E2-01** Open the **Customer panel** → Bulk order. Order Dal ×100 with the options you like, choose **Delivery**, select your saved address, a time **within the next 4 hours**, and send.
Expected: sent, as in E1.

**E2-02** Open the **Admin panel**.
Expected: Soundbox voice and the slider with **View**, no timer. Send a quote (for example ₹10,000 with ₹5,000 advance).

**E2-03** On the Customer panel accept and pay the advance (TEST).
Expected: *Confirmed*. On the **Cook panel** you hear the loud alert "New bulk order… Delivery…".

**E2-04** On the Cook panel tap **Start cooking**, then **Ready** (packed).
Expected: *Ready* on every panel. The Customer panel says "packed and will go out soon".

**E2-05** Watch the **Admin panel**.
Expected: if rider assigning is **automatic**, an offer goes to the rider at this moment. If it is **manual**, you hear an alert "needs a rider" and you assign one by hand: Delivery → the order → assign rider.

**E2-06** Log the Phone 3 out of the cook and log in as the **Rider**.
Expected: the rider home screen; the offer is there (automatic mode), with the sound.

**E2-07** On the **Rider panel** accept the offer and open the trip.
Expected: the customer's address is shown. The cash to collect is **only the balance** (for ₹10,000 with ₹5,000 advance it says ₹5,000). It must **never** say ₹10,000.

**E2-08** Open the **Customer panel**.
Expected: the bulk order shows a **Track the delivery** button.

**E2-09** On the Rider panel tap **Picked up**.
Expected: the Customer panel shows *On the way* and a push. Tap **Track the delivery**: live tracking opens and the rider moves on the map.

**E2-10** Wait as the rider gets close.
Expected: the Customer panel gets an "arriving soon" notification.

**E2-11** On the Rider panel at the door enter the customer's PIN (if the shop uses a PIN), mark **Delivered**, confirm the cash.
Expected: delivered.

**E2-12** Open the **Customer panel**.
Expected: **Delivered**, then **Completed**. It says "Balance paid: ₹5,000 (cash)". The invoice is available.

**E2-13** Open the **Admin panel** → the order, and the rider's cash screen.
Expected: same final status. The rider holds **₹5,000** (the balance), never ₹10,000.

**E2-14 (variation)** New delivery order. Before the rider arrives, on the Customer panel tap **Pay the balance now** and pay.
Expected: the **Rider panel** now shows **nothing to collect**.

**E2-15 (variation)** New delivery order. Before the rider arrives, on the Admin panel press **balance received (cash)**.
Expected: the Rider panel shows nothing to collect.

**E2-16 (variation)** Put every rider offline, then mark the order Ready on the Cook panel.
Expected: on the **Admin panel** you hear the voice and see a slider "no delivery partner free", and you can assign one by hand.

---

## E3. The customer cancels (refund rules)

**E3-01** Customer panel: send a request but **do not pay**; tap **Cancel this request**.
Expected: cancelled, no money involved.

**E3-02** Order for **3 days from now**. Admin quotes, Customer pays the advance. Then on the Customer panel tap **Cancel this order**.
Expected: a popup shows the **exact refund** ("the whole advance ₹… will go back"). After you confirm: cancelled and a push "your refund is on its way".

**E3-03** Open the **Admin panel**.
Expected: you hear the voice and see a slider "customer cancelled" with View. Open the **Cook panel**: the order has gone from *Bulk* and *To make* (a short alarm is normal).

**E3-04** New order for **about 10 hours from now** (notice hours = 1). Quote, pay the advance, then cancel on the Customer panel.
Expected: the popup says the **shop keeps the advance** and shows how much. After confirming it cancels with no refund of the advance.

**E3-05** Look at the Razorpay test dashboard for E3-02.
Expected: the refund amount equals the amount the app showed.

---

## E4. The cook has a problem; the admin decides

**E4-01** Make a bulk order, quote it, pay the advance (as in E1).
Expected: the Cook panel has the alert and the order in the Bulk tab.

**E4-02** On the **Cook panel** open the Bulk card → **Tell the owner about a problem** → *A dish is finished* → pick a dish → send.
Expected: "The owner was told".

**E4-03** Open the **Admin panel**.
Expected: you hear the Soundbox voice with a slider/popup "Kitchen problem" naming that order.

**E4-04** Answer **Tell the customer** (polite note).
Expected: the cook's card shows what the owner decided.

**E4-05** Open the **Customer panel** and tap the note.
Expected: the **bulk order** opens (not "order not found").

**E4-06** Cook reports another problem on another bulk order. Admin answers **Cancel the order**.
Expected: the **whole bulk order is cancelled** and everything the customer paid online goes back.

**E4-07** Open the **Customer panel**.
Expected: **Cancelled by the shop**, the refund message, and a refund push.

**E4-08** New paid bulk order. On the **Admin panel** open the normal **Orders** list and find the entry named "**Bulk order <code>**" (the work ticket the cook uses). Cancel it **from there**.
Expected: the **whole bulk order cancels** and the customer is refunded, the same as E4-06.

**E4-09** Try to cancel that same entry from the **Cook panel** or **Rider panel**.
Expected: they cannot; a message says this is a bulk order.

---

## E5. The 24-hour rule and the cook's alerts

**E5-01** Customer panel: bulk order wanted about **30 hours from now**; Admin quotes; Customer pays the advance.
Expected: the Cook panel rings loud with the voice "New bulk order…". The order is in the **Bulk** tab only, not in *To make*.

**E5-02** About **6 hours later** (when it is 24 hours before the time) open the **Cook panel**.
Expected: a **second loud alert and push**: "Bulk order to make for <day>". The order has **jumped to the top of To make**, above any other order, with the BULK badge. It stays in the Bulk tab too.

**E5-03** Look at the card's clock.
Expected: it does not say *Late*. (A bulk order is late only after its own day and time have passed.)

**E5-04** Make another bulk order wanted only about **10 hours from now**; pay the advance.
Expected: the Cook panel gets **one** alert saying "Bulk order to make" and the order is straight in **To make** at the top.

**E5-05** Leave it unfinished until the wanted time passes.
Expected: the card turns **Late** (red).

**E5-06** On a far-away order tap **Already made: mark Ready** (without Start).
Expected: it goes straight to *Ready*; the Customer panel is told; it stays in the Bulk tab until delivered. If it is a delivery, no rider is asked yet (riders are asked about 2 hours before the time).

---

## E6. Pause

**E6-01** Admin panel → Bulk orders → switch **Pause bulk orders** ON and confirm.
Expected: "Bulk orders are paused".

**E6-02** Customer panel → Account.
Expected: the Bulk order row says **Temporarily unavailable**. Opening it shows a paused page with a **My bulk orders** button and no menu.

**E6-03** Customer panel → My bulk orders.
Expected: earlier orders are all there, and an already confirmed order carries on normally (cook can cook it, you can pay the balance).

**E6-04** Admin panel: switch Pause OFF.
Expected: "Bulk orders are open again". The customer can order again.

**E6-05** Admin panel → Services → tap **Pause** on a service and confirm.
Expected: a **Paused** pill appears and the button turns into **Resume**.

**E6-06** Customer panel → Services.
Expected: that card is dimmed with "**Temporarily unavailable**". Opening it shows an amber notice, a greyed-out form and a disabled button. An inquiry already sent still opens and chat works.

**E6-07** Admin panel: tap **Resume**.
Expected: the customer can send a new inquiry again.

---

## E7. Service inquiry, Party / Venue Booking, from start to finish

**E7-01** Admin panel → Services → add **Party / Venue Booking**.
Expected: a new service with sensible questions. It starts **OFF**.

**E7-02** Add a photo, a price and two bullet points, then switch it **LIVE**.
Expected: saved.

**E7-03** Customer panel → Account → Services.
Expected: the service shows as a picture card with the name and price.

**E7-04** Open it.
Expected: the **simple header**: a normal top bar with the back arrow and the service name. **No huge empty header.** The photo is a modest rounded picture under the bar. The price shows at the bottom next to **Inquire**. Name and phone are filled in.

**E7-05** Fill the form (date, guests, a message chip) and send.
Expected: "Sent". It appears in **My inquiries**.

**E7-06** Open the **Admin panel**.
Expected: Soundbox voice (English then Hindi) with a slider and a **View** button. View opens the inquiry with the answers, the estimate and Call/WhatsApp buttons.

**E7-07** Reply on the Admin panel.
Expected: the Customer panel gets a notification; tapping it opens the conversation.

**E7-08** Write a few messages each way.
Expected: each message arrives on the other panel with a sound.

**E7-09** Admin marks it *Quoted*, then *Confirmed*.
Expected: the Customer panel shows each status.

**E7-10** Admin switches the service **OFF**.
Expected: it disappears from the customer's Services. If the shop has only one live service the Account row shows that service's own name; with two or more it says **Services**.

**E7-11** Open a **Tiffin** service (or any other starter) on the Customer panel.
Expected: the same simple header as E7-04.

---

## E8. The reports

**E8-01** Admin panel → **Business report** (last 7 days), after a completed bulk order from E1.
Expected: the big sales number includes it, and under it: "**Of this, from bulk orders**: ₹… · N orders · X% of your sales".

**E8-02** Open the report for a period with no bulk orders.
Expected: that line is not there.

**E8-03** Admin panel → **Closing report** for today.
Expected: "Includes bulk orders: N · ₹…" under the sales, and the order is counted **once**.

**E8-04** Look at the Orders history and the sales list.
Expected: the cook's work ticket does not appear as a second sale.

**E8-05** Admin panel → Business report.
Expected: a completed bulk order counts as **one** order.

---

## E9. Languages and the voice

Repeat one new bulk order (request to payment) with the Cook panel and the Admin panel set to each language (Profile → language).

**E9-01** Hindi.
Expected: the cook's voice says "नया बल्क ऑर्डर, <date>, <time> बजे के लिए, पिकअप…". The push title reads "नया बल्क ऑर्डर, … के लिए" (the month may stay in English).

**E9-02** Marathi, Gujarati, Bengali.
Expected: the same sentence in that language (the month name may stay English; dish names stay as they are).

**E9-03** In all four languages open the Bulk tab and card, Order again, the pause page, the reports card and the service page header.
Expected: nothing is left in English except dish names and the order code. Buttons fit; nothing is cut off.

---

## E10. Every notification opens the right screen

For each event, tap the notification from the lock screen and again from the Notifications list.

**E10-01** Admin panel: new bulk request, advance paid, customer cancelled. Expected: opens that **bulk order**.

**E10-02** Customer panel: quote received, stage change, completed, refund, the shop's note. Expected: opens the **bulk order**.

**E10-03** Customer panel: table booking confirmed / paid / reminder. Expected: opens **My reservations**.

**E10-04** Customer panel: points earned. Expected: opens **My points**.

**E10-05** Customer panel: a normal order update. Expected: opens that order.

**E10-06** Admin panel: a pickup customer says "I'm coming / I'm here". Expected: opens that order.

**E10-07** Admin panel: a table asks for the bill. Expected: opens the **Tables** screen.

**E10-08** Admin panel: a cook or rider goes on duty. Expected: opens that person's page.

**E10-09** Rider panel: a new offer or an assigned order. Expected: opens the **trip page**.

**E10-10** Cook panel: a leave answer. Expected: opens the **Leave** page.

**E10-11** Admin panel: daily summary, weekly digest. Expected: opens the Business page.

---

## E11. Breaking things on purpose (10 minutes)

**E11-01** Customer panel: double-tap **Accept and pay** quickly. Expected: only **one** payment is taken.

**E11-02** Customer panel: close the app right after paying and open it a minute later. Expected: the order shows **Confirmed**, not stuck.

**E11-03** Cook panel: airplane mode on, then off. Expected: the Bulk tab refreshes by itself.

**E11-04** Admin and Cook both tap *Ready* at about the same time. Expected: no error, nobody is confused.

**E11-05** Customer panel: open an old notification for a cancelled order. Expected: it opens and shows the order's state, no crash.

**E11-06** Customer panel: pay the advance **after** the owner already cancelled the request. Expected: the money comes back automatically.

---

## E12. The quote shows the time to make it

**E12-01** Admin panel: open a new bulk request → quote form → find **Time to make it (optional)**. Enter 5.
Expected: field in hours; a hint says the customer and the cook are told. Enter 0 and send: it is refused.

**E12-02** Enter 5.3 and send the quote.
Expected: it is kept as 5.5 hours (half-hour steps).

**E12-03** Customer panel: open the quote.
Expected: "The shop needs about 5.5 hours to make this".

**E12-04** Customer pays the advance. Cook panel: Bulk tab.
Expected: the card says **Wanted on <day> at <time>** and under it **Needs about 5.5 hours**.

---

## E13. Chat on a bulk order (WhatsApp style)

**E13-01** Customer panel: open the bulk order → **Chat with the shop**. Send "Can you make it less spicy?".
Expected: your message is on the right with ONE grey tick (sent).

**E13-02** Admin panel: you get a notification "New message from <name>"; tap it.
Expected: the Chat screen opens (not the bulk list) and the message is there. On the Customer phone the ticks turn to TWO grey ticks (delivered), then TWO coloured ticks (read) once the Admin has the chat open. The tick colours must be easy to see on the bubble colour of the shop.

**E13-03** Admin panel: keep the chat open; the Customer sends another message.
Expected: it appears at once with **no sound and no slider** (the chat is open). When the Customer types, the Admin sees "typing…".

**E13-04** Admin panel: send a photo from the camera, one from the gallery, then a voice note (hold the mic, speak 5 seconds, release).
Expected: the Customer sees the photos (tap to open full screen) and can play the voice note. A voice note over about 2 minutes is refused with a clear message.

**E13-05** Customer phone: airplane mode, send a message, switch back on.
Expected: it shows "Not sent. Tap to try again." and sending again works, with no double message.

**E13-06** Send several messages in a row while the other phone is on another screen.
Expected: ONE notification for the burst, not one per message. The Chat button on the bulk order shows a red number; the bulk list shows a small chat badge.

**E13-07** (needs 3 days) After the bulk order is delivered or cancelled, wait 3 days.
Expected: the chat says "This chat is closed." and cannot be written to; old messages can still be read. Before that, a line says it closes in N day(s).

---

## E14. Chat on service inquiries and table bookings

**E14-01** Customer panel: open an inquiry (Services). There is a **Chat with the shop** button; the old Chat tab is gone. Older messages (if any) show first.

**E14-02** Admin panel: open the inquiry → **Chat with the customer**; reply with text and a picture.
Expected: same ticks, typing and photo behaviour as E13. (The old quick-reply buttons are gone, by design.)

**E14-03** Admin panel: tap **End conversation** on the inquiry.
Expected: the Customer's chat shows "This chat is closed." Tap **Open it again**: the Customer can write again.

**E14-04** Customer panel: My bookings → a booking card → **Chat with the restaurant**. Ask "Window seat please".
Expected: Admin panel: Bookings → that booking card has **Chat with the guest**; the message is there, with a red number before opening.

**E14-05** A booking chat closes 3 days after the booking time (or 3 days after it was cancelled): check an old booking, you can read but not write.

---

## E15. Rating, complaint and refund on a bulk order

**E15-01** Finish a bulk order (E1, or E2 until delivered). Customer panel: open the bulk order.
Expected: BELOW the details you see **Rate this order** (stars and words), for a delivery order also the **delivery rating**, and a **complaint** card.

**E15-02** Give 5 stars with a comment. Close and reopen the order.
Expected: "Your review" with the stars; **Edit your review** works. (Review points appear in Rewards after the hold time.)

**E15-03** Send a complaint: type "late" and write a few words. (A "wrong item" or "quality" complaint needs a photo.)
Expected: sent; the card shows it is waiting for the shop.

**E15-04** Admin panel: complaints list.
Expected: the card says **Bulk order <code> · late** (not a plain number) and a notification came. Open it: the button says **Open bulk order <code>** and opens the bulk order.

**E15-05** Admin panel: choose **Partial refund** of ₹1,000 and write a reply; send.
Expected: allowed up to the WHOLE bulk total (for example ₹10,000, not just the balance). The Customer is told. **The app sends no money**: the refund is only written down, and you return the money yourself (cash/UPI). Check in the Razorpay dashboard that NO refund was created.

**E15-06** Try a refund bigger than the whole total.
Expected: refused.

---

## E16. Bulk balance by QR, pickup code, and not blocking normal orders

**E16-01** The shop has a UPI ID saved. Bulk pickup, ready. Admin panel: open it → pay by QR.
Expected: a QR for the balance only. After paying, the "received" button marks the balance paid (by UPI). Without a UPI ID saved the QR button is hidden.

**E16-02** Waiter panel: on a shop with no UPI ID, "Show QR to pay" is hidden.

**E16-03** Bulk delivery: the rider's door QR pays the balance; the order becomes paid and completed.

**E16-04** Bulk pickup: the Customer sees a **pickup code**. The Admin hands over: the code is asked; a wrong code is refused.

**E16-05** The Customer's bottom bar shows the bulk pickup half an hour before the time.

**E16-06** With a bulk delivery and a bulk pickup open, the same customer can still place a normal delivery and a normal pickup order, and the rider's "open orders / cash owed" limits do not count the bulk ticket.

---

## E17. Shop closed: riders, cooks and waiters

**E17-01** Rider panel on duty with no delivery. Admin panel: pause the shop (or switch it off).
Expected: the Rider is **off duty** within a minute (usually at once) and gets "The shop is closed, so you were put off duty."

**E17-02** Rider panel: try to go on duty while the shop is paused/closed.
Expected: refused with "The shop is closed right now, so you cannot go on duty. You can when it opens." A rider who still has a delivery in hand is NOT switched off.

**E17-03** Cook and Waiter panels: with the shop closed they show off duty and cannot go live ("The shop is closed right now, so you cannot go live"). A cook with an accepted order still in hand stays on until it is finished.

**E17-04** A rider with **own working hours (Auto mode)** whose time is still running: open the shop again.
Expected: within about a minute he is switched ON by himself. A rider in manual mode must tap **Start duty**. A rider who switched himself off by hand during his time stays off.

---

## E18. Quick regression

**E18-01** Normal (non-bulk) orders, delivery and pickup: still place, accept, cook and deliver as before.

**E18-02** Alerts screen: the new group **Chat messages** (Slider, Sound, Voice). Listen plays a sample.

**E18-03** Switch the app to Hindi and Marathi: the chat screen and buttons, "Needs about N hours" and the complaint titles are translated. (Bhojpuri is not translated on purpose.)

---

## How to report

Write the **step number**, which **panel**, and **what you saw**. Examples:
- `E1-13 · Cook panel · it rang but did not speak, only the push showed`
- `E2-07 · Rider panel · the page asked ₹10,000, not ₹5,000`
- `E7-04 · Customer panel · header is still big`

Add `(looks)` if it works but looks ugly, `(slow)` if it works but is slow.
