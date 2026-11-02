# Bulk orders + Services: end-to-end test cases (3 phones)

Each test case is one whole story, from the first tap to the last screen. Every step has its own number (like `E1-07`). Tell me the number and what you saw.

**Phones**
- **Phone 1 = CUSTOMER** (a customer login, not the owner's number)
- **Phone 2 = OWNER** (the shop owner / "admin")
- **Phone 3 = COOK**; in the delivery stories it is switched to the **RIDER** login when told

**Before you start (do once, about 15 minutes)**
- Superadmin app: for the test shop, App features → switch **Services** ON and **Bulk orders** ON. Shop → Payments: the shop has **Razorpay TEST keys** and they pass the test.
- Owner: the menu has 3 dishes, for example Dal ₹100, Paneer ₹200 and Rice ₹60 (one with Half/Full choices). Bulk orders → Settings → **Use recommended settings**, then set **notice hours to 1**, pickup and delivery both ON, **Take bulk orders** ON. On the dishes, set a **bulk price** lower than the normal price.
- Owner: Staff → add a **cook** (Kitchen ON) and a **rider** (online). Alerts: *Bulk orders* and *Kitchen problems* have the Slider and Sound ON.
- Phone 3: log in as the cook and switch to *On duty*. You must see four tabs: **To make, By dish, Bulk, Ready**. If there is no Bulk tab the app is an old build: install the latest first.
- Customer: log in and save one address.
- Use Razorpay **test** money only.

Whenever a step says "the owner hears it", you should get: the slider, the sound, and the voice (English then Hindi). The bulk slider has **no countdown bar**; it stays until you close it.

---

## E1. A pickup bulk order, from request to invoice (the main story)

**Goal:** one customer orders 100 Dal and 20 Paneer for pickup tomorrow. It goes through quote, advance, cooking, balance and invoice.

**E1-01 · Customer** opens Account → **Bulk order**.
Expect: the full menu with a counter on every dish. Half/Full dishes show their options.

**E1-02 · Customer** adds Dal ×100 and Paneer ×20, picks **Pickup**, tomorrow, 1:00 pm.
Expect: the price updates while you add. Dishes with a bulk price show the lower price. Name and phone are already filled in.

**E1-03 · Customer** first tries to send with a very small order (for example Rice ×2).
Expect: a clear message about the minimum order. It is not sent.

**E1-04 · Customer** goes back to the real order and taps **Ask the shop for a quote**.
Expect: "Sent". In **My bulk orders** the order shows *Waiting for the shop's quote*, with a code like B7K2QX.

**E1-05 · Owner** (at the same moment).
Expect: slider "new bulk order request", sound and voice. **No countdown bar.** Tapping **View** opens that very order.

**E1-06 · Owner** changes one unit price, writes a short note, and taps **Send quote**.
Expect: quote sent; the order now says *Quote sent*.

**E1-07 · Customer** gets a push "Your quote is ready" and taps it.
Expect: it opens the bulk order page (not a blank page, not "order not found"). It shows the lines, the total, the **advance (50%)**, the **balance**, and the refund rule ("cancel at least 18 hours before… ").

**E1-08 · Customer** taps **Ask for a change**, writes "please reduce Paneer to 15", sends.
Expect: the owner gets a slider and a notification; tapping it opens the order. The order shows *change requested* to the owner.

**E1-09 · Owner** edits the quote (Paneer 15) and sends it again.
Expect: the customer is told, and the order shows the new quote.

**E1-10 · Customer** taps **Accept and pay ₹… now** and pays with Razorpay TEST UPI/card.
Expect: back on the order it says **Confirmed**, with the advance paid shown.

**E1-11 · Owner** (at the same moment).
Expect: slider/notification "advance paid, order confirmed". Tapping opens the order.

**E1-12 · Cook (Phone 3)** (at the same moment as E1-10).
Expect: a **loud alert, voice and push**: "New bulk order. Wanted on <tomorrow's date> at 1:00 pm. Pickup. 100 Dal, 15 Paneer."
Then open the **Bulk** tab: the order is there with a **BULK ORDER · code** badge, "Wanted on …", and the dishes. It is **not** in *To make* yet (the day is more than 24 hours away is the usual case; if you chose a time within 24 hours it **is** in To make at the top, see E5).

**E1-13 · Cook** does nothing for about a minute.
Expect: the ringing stops by itself.

**E1-14 · Customer** opens the Orders tab (bottom bar).
Expect: one card with a **Bulk** label, status, dishes, total, and button **View**. There is **no second** "Order #…" card for the same order. Tap the chip **Bulk Order**: only bulk orders show.

**E1-15 · Cook** taps **Start cooking** on the card.
Expect: the card changes to *Cooking*.

**E1-16 · Customer** looks at the bulk order.
Expect: status **Being made**, and a push "The shop is making your order".

**E1-17 · Owner** looks at the bulk order.
Expect: status moved to *Preparing* on its own. You did not tap anything.

**E1-18 · Cook** taps **Ready**.
Expect: the card says *Ready*.

**E1-19 · Customer** looks at the order.
Expect: status **Ready** and a push "ready, collect it at the time you chose". The page says "The balance … is paid at the handover".

**E1-20 · Customer** taps **Pay the balance … now** and pays with TEST money.
Expect: the order shows the balance as paid online.

**E1-21 · Owner** looks at the order.
Expect: "balance paid online" appears, with the notification for it.

**E1-22 · Owner** taps **Handed over / Delivered**.
Expect: the customer gets a push; the status is **Delivered**, then moves to **Completed** a moment later.

**E1-23 · Customer** looks at the order.
Expect: **Completed**, and buttons **View** and **Save** for the invoice.

**E1-24 · Customer** taps **View** on the invoice.
Expect: an invoice showing the bulk order code, the quote lines, GST (if the shop has GST on), the advance and the balance.

**E1-25 · Customer** goes to Orders. The Bulk card now has the button **Order again**.
Expect: yes, it says **Order again** (not View).

**E1-26 · Customer** taps **Order again**.
Expect: the bulk menu opens **with the same dishes and quantities already filled in**. The day, time and address are asked again. A dish the shop no longer has is left out with a short message.

---

## E2. A delivery bulk order with a rider (cash balance, live tracking)

**Goal:** the rider collects **only the balance** in cash; the customer follows the delivery.

**E2-01 · Customer** makes a new bulk order (Dal ×100), picks **Delivery**, selects the saved address, a time later today or tomorrow, and sends it.
Expect: sent as in E1.

**E2-02 · Owner** sends the quote (for example ₹10,000; advance ₹5,000).
Expect: the customer's quote shows a delivery fee (or "free" by the rules).

**E2-03 · Customer** accepts and pays the advance (TEST).
Expect: *Confirmed*. The cook gets the loud alert "New bulk order… Delivery…".

**E2-04 · Cook** taps **Start cooking**, then **Ready**.
Expect: *Ready* on all phones. The customer's page says "packed and will go out soon".

**E2-05 · Owner** (rider mode **automatic**): at the moment the cook marks Ready the rider is asked.
Expect: the rider gets an offer. (With **manual** mode instead, the owner gets "needs a rider" and assigns one: Delivery → the order → assign rider.)

**E2-06 · Phone 3:** log out of the cook, log in as the **rider**.
Expect: the rider's home screen. The offer is there (if automatic).

**E2-07 · Rider** accepts the offer.
Expect: the trip page opens with the customer's address. The **cash to collect is only the balance** (for the ₹10,000 order with ₹5,000 advance it says ₹5,000). It must **never** show ₹10,000.

**E2-08 · Customer** looks at the bulk order.
Expect: a **Track the delivery** button.

**E2-09 · Rider** marks **Picked up**.
Expect: the customer's order says *On the way* and gets a push. Tapping **Track the delivery** opens live tracking with the rider moving on the map.

**E2-10 · Customer** (as the rider gets close).
Expect: a "arriving soon" notification.

**E2-11 · Rider** reaches the door; if the shop uses a delivery PIN, enters the PIN the customer shows; marks **Delivered** and confirms the cash.
Expect: delivered.

**E2-12 · Customer** looks at the order.
Expect: **Delivered**, then **Completed**; "Balance paid: ₹5,000 (cash)"; the invoice is available.

**E2-13 · Owner** looks at the order and at the rider's cash.
Expect: the same final status; the rider holds **₹5,000** (the balance), not ₹10,000.

**E2-14 (variation A) · Customer pays the balance online BEFORE the rider arrives** (new order, same steps up to E2-07, then the customer taps *Pay the balance now*).
Expect: the rider's trip page now shows **nothing to collect**.

**E2-15 (variation B) · Owner presses "balance received (cash)"** before the rider arrives.
Expect: same, nothing to collect for the rider.

**E2-16 (variation C) · No rider online** when the cook marks Ready.
Expect: the owner gets "no delivery partner free" and can assign one by hand.

---

## E3. The customer cancels (refund rules)

**E3-01 · Customer** sends a request but does **not** pay yet, then taps **Cancel this request**.
Expect: cancelled. No money involved.

**E3-02 · Customer** makes a new order for **3 days from now**, the owner quotes it, the customer pays the advance. Then taps **Cancel this order**.
Expect: a popup shows the **exact refund** ("the whole advance ₹… will go back"). After you confirm: cancelled; push "your refund is on its way".

**E3-03 · Owner** looks at it.
Expect: notification "customer cancelled", opens the order. **The cook's phone:** the order disappears from *Bulk* and *To make* (a short alarm sound is normal).

**E3-04 · Customer** makes an order for **about 10 hours from now** (set notice hours to 1), the owner quotes it, the customer pays the advance, then cancels.
Expect: the popup says the **shop keeps the advance** and shows how much. After confirming, it is cancelled with no refund for the advance.

**E3-05 · Razorpay test dashboard:** compare with E3-02.
Expect: the refund amount equals what the app said.

---

## E4. The cook has a problem; the owner decides

**E4-01 · Customer** makes a bulk order, the owner quotes, the customer pays the advance.
Expect: as before; the cook has the alert and the order in the Bulk tab.

**E4-02 · Cook** on the Bulk card taps **Tell the owner about a problem**, chooses *A dish is finished*, picks a dish, and sends.
Expect: "The owner was told".

**E4-03 · Owner** (at the same moment).
Expect: popup/slider "Kitchen problem" with sound, naming the order.

**E4-04 · Owner** answers **Tell the customer** (polite note).
Expect: the cook's card shows what the owner decided.

**E4-05 · Customer** gets the note and taps it.
Expect: opens the **bulk order** (not "order not found").

**E4-06 · Cook** reports a second problem on the same or another order.
Expect: works the same way.

**E4-07 · Owner** this time answers **Cancel the order**.
Expect: the **whole bulk order is cancelled** and everything the customer paid online goes back.

**E4-08 · Customer** looks at the order.
Expect: **Cancelled by the shop**, the refund message, and a refund push.

**E4-09 · Another order, cancelled from the Orders screen.** Owner: make and pay another bulk order. Then open the owner's **Orders** list and find the entry called "**Bulk order <code>**" (this is the work ticket the cook uses). Cancel it **from there**.
Expect: the **whole bulk order cancels** and the customer is refunded, the same as E4-07.

**E4-10 · Cook and rider** try to cancel that ticket.
Expect: they **cannot**; a message says this is a bulk order.

---

## E5. The 24-hour rule

**E5-01 · Customer** makes a bulk order wanted about **30 hours from now**; the owner quotes; the customer pays the advance.
Expect: the cook gets the loud "New bulk order…" alert (E1-12). The order is in the **Bulk** tab only, not in *To make*.

**E5-02 · Cook** checks again **about 6 hours later**, when the time is 24 hours away.
Expect: a **second loud alert and push**: "Bulk order to make for <day>". The order **jumps to the top of To make**, above any other order, with the BULK badge. It also stays in the Bulk tab.

**E5-03 · Cook** looks at the card.
Expect: it does **not** say *Late*. (A bulk order is late only after its own day and time have passed.)

**E5-04 · A second order, wanted only about 10 hours from now.** Customer pays the advance.
Expect: the cook gets **one** alert saying "Bulk order to make", and the order is **straight in To make at the top**.

**E5-05 · Cook** does not finish it and the wanted time passes.
Expect: the card turns **Late** (red).

**E5-06 · A bulk order made early.** On a far-away order, the cook taps **Already made: mark Ready** (without pressing Start).
Expect: it goes straight to *Ready*, and the customer is told. It stays in the Bulk tab until delivered. (If it is a **delivery**, the rider is **not** asked yet; riders are asked about 2 hours before the time.)

---

## E6. Pause (stop new requests for a while)

**E6-01 · Owner** Bulk orders screen → switch **Pause bulk orders** ON, confirm.
Expect: "Bulk orders are paused".

**E6-02 · Customer** opens Account.
Expect: the Bulk order row says **Temporarily unavailable**. Opening it shows a paused page with a **My bulk orders** button and **no menu**.

**E6-03 · Customer** opens **My bulk orders**.
Expect: the earlier orders are all there, and an order already confirmed carries on normally (the cook can cook it, you can pay the balance).

**E6-04 · Owner** switches Pause OFF.
Expect: "Bulk orders are open again". The customer can order again.

**E6-05 · Owner** Services list: tap **Pause** on a service, confirm.
Expect: a **Paused** pill and the button becomes **Resume**.

**E6-06 · Customer** Services.
Expect: that service's card is dimmed with "**Temporarily unavailable**". Opening it shows an amber notice, a greyed-out form, and a disabled button. An inquiry already sent still opens and its chat works.

**E6-07 · Owner** taps **Resume**.
Expect: the customer can send a new inquiry again.

---

## E7. A service inquiry (Party / Venue Booking) from start to finish

**E7-01 · Owner** Services → add **Party / Venue Booking** (starter).
Expect: a new service with sensible questions. It starts **OFF**.

**E7-02 · Owner** adds a photo, a price, two bullet points, then switches it **LIVE**.
Expect: saved.

**E7-03 · Customer** opens Account → Services (or the service row).
Expect: the service appears as a picture card with the name and the price over it.

**E7-04 · Customer** opens it.
Expect: the **simple header**: a normal top bar with the back arrow and the service name. There is **no huge empty header**. The photo (if you added one) is a modest rounded picture under the bar. The price shows at the bottom next to the **Inquire** button. Name and phone are filled in.

**E7-05 · Customer** fills the form (date, guests, a message chip), sends.
Expect: "Sent"; it appears in **My inquiries**.

**E7-06 · Owner** (at the same moment).
Expect: slider, sound, voice (English then Hindi). **View** opens the inquiry with the answers, the estimate, and Call/WhatsApp buttons.

**E7-07 · Owner** replies.
Expect: the customer's phone gets a notification; tapping it opens the conversation.

**E7-08 · Both** write a few messages back and forth.
Expect: each message arrives on the other phone and the sound plays.

**E7-09 · Owner** marks it *Quoted*, then *Confirmed*.
Expect: the customer sees the status change.

**E7-10 · Owner** switches the service **OFF**.
Expect: it **disappears** from the customer's Services. If the shop has only **one** live service, the Account row shows **that service's own name**; with two or more it says **Services**.

**E7-11 · Do the same for a Tiffin service** (or any other starter): open it as the customer.
Expect: the same simple header as E7-04.

---

## E8. The reports

**E8-01 · Owner** opens the **Business report** (last 7 days) after at least one **completed** bulk order (E1).
Expect: the big sales number **includes** it. Under it: "**Of this, from bulk orders**: ₹… · N orders · X% of your sales".

**E8-02 · Owner** checks the report on a shop or period with **no** bulk orders.
Expect: that line is **absent**.

**E8-03 · Owner** opens the **Closing report** for today.
Expect: "Includes bulk orders: N · ₹…" under the sales, and the bulk order counted **once** (not twice).

**E8-04 · Owner** looks at the Orders history and the sales list.
Expect: the cook's work ticket does **not** appear as a second sale.

**E8-05 · Owner** Rent / bill screen.
Expect: a completed bulk order counts as **one** order.

---

## E9. Languages and the voice

Repeat one new bulk order (request to payment) with the **cook phone and the owner phone** set to each language.

**E9-01 · Hindi.** Cook alert at payment.
Expect: the voice says "नया बल्क ऑर्डर, <date>, <time> बजे के लिए, पिकअप…". The push title reads "नया बल्क ऑर्डर, … के लिए" (the month may stay in English).

**E9-02 · Marathi, Gujarati, Bengali.** Cook alert.
Expect: the same sentence in that language (the month name may stay English; dish names stay as they are).

**E9-03 · All four languages:** Bulk tab, the card, the **Order again** screens, the pause page, the reports card, and the new service page header.
Expect: nothing left in English except dish names and the order code. Buttons fit; nothing is cut off.

---

## E10. Every notification opens the right screen

For each, trigger the event, then tap the notification **from the lock screen and from the Notifications list**.

**E10-01 · Owner** new bulk request, advance paid, customer cancelled → opens that **bulk order**.

**E10-02 · Customer** quote received, stage change, completed, refund, shop's note → opens the **bulk order**.

**E10-03 · Customer** table booking confirmed / paid / reminder → opens **My reservations**.

**E10-04 · Customer** points earned → opens **My points**.

**E10-05 · Customer** a normal order update → opens that order.

**E10-06 · Owner** a pickup customer says "I'm coming / here" → opens that order.

**E10-07 · Owner** a table asks for the bill → opens the **Tables** screen.

**E10-08 · Owner** a cook or rider goes on duty → opens that person's page.

**E10-09 · Rider** a new offer or an assigned order → opens the **trip page**.

**E10-10 · Cook** a leave answer → opens the **Leave** page.

**E10-11 · Owner** the daily summary, weekly digest, rent bill → opens the Business or Rent page.

---

## E11. Breaking things on purpose (10 minutes)

**E11-01 · Customer** double-taps **Accept and pay** quickly.
Expect: only **one** payment is taken.

**E11-02 · Customer** closes the app right after paying and opens it a minute later.
Expect: the order shows **Confirmed**, not stuck.

**E11-03 · Cook phone** in airplane mode, then back on.
Expect: the Bulk tab refreshes by itself.

**E11-04 · Owner and cook** both tap *Ready* about the same time.
Expect: no error; nobody is confused.

**E11-05 · Customer** opens an old notification for a cancelled order.
Expect: it opens and shows the order's state, no crash.

**E11-06 · Customer** pays the advance **after** the owner already cancelled the request.
Expect: the money **comes back automatically**.

---

## How to report

Write: **the step number**, which **phone**, and **what you saw**. Examples:
- `E1-12 · Cook · it rang but did not speak, only the push showed`
- `E2-07 · Rider · the page asked ₹10,000, not ₹5,000`
- `E7-04 · Customer · header is still big`

Add `(looks)` if it works but looks ugly, `(slow)` if it works but is slow.
