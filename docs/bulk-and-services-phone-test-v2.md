# Bulk orders + Services: phone test (3 phones at once)

> **Newer parts (chat, time to make it, bulk ratings and complaints, shop-closed duty) are in `bulk-and-services-end-to-end-tests.md`, stories E12 to E18. For a bulk DELIVERY always pick a time less than 4 hours away, or the rider is not asked yet.**

Every line has a **serial number** (like `C-07`). When something is wrong, tell me the number and what you saw ("C-07: the button was missing").
The computer tested all the logic (1,300+ tests), but **nothing here was ever tried on a real phone**. That is what this page is for.

## Your three phones

| Phone | Who it is | Used in |
|---|---|---|
| **Phone 1 = CUSTOMER** | A customer account (not the owner's number) | all rounds |
| **Phone 2 = OWNER** | The shop owner ("admin") login | all rounds |
| **Phone 3 = COOK** (rounds 3–6), then **RIDER** (rounds 7–8) | log out and log in as the rider when round 7 starts | see rounds |

The superadmin app is only needed in **Round 0** (one-time setup). Do it on any phone, then put that phone back to its job.

Keep a pen and write the serial number of anything that looks wrong, slow, ugly, or confusing. "Looks odd" is a real answer.

---

## ROUND 0 · One-time setup (about 15 minutes)

| # | Phone | Do | Expected |
|---|---|---|---|
| 0-01 | Superadmin | Shops → your test shop → App features | You see switches for **Services**, **Table booking**, **Bulk orders** |
| 0-02 | Superadmin | Switch **Services** ON and **Bulk orders** ON for the test shop | Both stay on after you leave and come back |
| 0-03 | Superadmin | Shop → Payments: the shop has **Razorpay TEST keys** saved and the test passes | "Connected" or similar; no red error |
| 0-04 | Owner | Menu: make sure there are 3 dishes (e.g. Dal ₹100, Paneer ₹200, Rice ₹60), at least one with options (Half / Full) | Dishes visible |
| 0-05 | Owner | Staff → add a **cook** (a phone number you can log in with) and switch the Kitchen on; add a **rider** and put him online | Cook and rider appear in the lists |
| 0-06 | Phone 3 | Log in as the **cook**, switch to *On duty* | Cook screen opens with tabs **To make / By dish / Bulk / Ready** |
| 0-07 | Customer | Log in, save one **address** (Account → Addresses) | Address saved |
| 0-08 | Owner | Alerts: make sure *Bulk orders*, *Kitchen problems* have the **Slider** and **Sound** switches ON | Switches on |

If 0-06 shows only three tabs (no **Bulk**), stop: the app is an old build. Install the latest, then continue.

---

## ROUND 1 · Services (owner on Phone 2, customer on Phone 1)

| # | Phone | Do | Expected |
|---|---|---|---|
| S-01 | Owner | Menu and offers → **Services** | List of services. A new shop shows the starters |
| S-02 | Owner | Add **Party / Venue Booking** (starter) | New service opens with sensible questions. It starts **OFF** |
| S-03 | Owner | Add a photo, a price and 2 bullet points. Switch the service **LIVE** | Saves without error |
| S-04 | Customer | Account → Services (or the service's own row) | The service shows as a **picture card** with its name and price over the picture |
| S-05 | Customer | Open it | Picture header, price, bullets, then the form. Name and phone are already filled in |
| S-06 | Customer | Fill the form, send | "Sent" message. It appears in **My inquiries** |
| S-07 | Owner | (at the same time) | **Slider** appears + the **voice** speaks (English, then Hindi). Opens the inquiry on **View** |
| S-08 | Owner | Reply to the inquiry | Customer's phone gets a notification; tapping it opens the **conversation** |
| S-09 | Owner | Services list → tap **Pause** on the service | A confirm appears, then a **Paused** pill shows on the row; the button turns to **Resume** |
| S-10 | Customer | Look at Services again (pull to refresh) | The card is **dimmed** with "**Temporarily unavailable**" |
| S-11 | Customer | Open it | An amber box: "Sorry, this service is temporarily unavailable". The form is greyed out; the button says *Temporarily unavailable* and does nothing |
| S-12 | Customer | Open the **inquiry you already sent** | It still opens and chat still works (paused only stops NEW requests) |
| S-13 | Owner | Tap **Resume** | Customer can send a new inquiry again |
| S-14 | Owner | Switch one service **OFF** (slider) | It **disappears** from the customer's Services |
| S-15 | Customer | Account screen | If the shop has ONE live service, the row shows **its own name**; with 2 or more it says **Services** |

---

## ROUND 2 · Bulk order setup (owner Phone 2 + customer Phone 1)

| # | Phone | Do | Expected |
|---|---|---|---|
| B-01 | Owner | Bulk orders → **Settings** | Rules screen opens |
| B-02 | Owner | Tap **Use recommended settings** | Asks first; then fills: min ₹3000, notice 24h, advance 50%, quote valid 24h, full refund 18h. It does **not** switch bulk ordering on or off |
| B-03 | Owner | Change **notice hours to 1** (for testing today), pickup + delivery both ON. Switch **Take bulk orders** ON | Saves |
| B-04 | Owner | Open a dish → find the **bulk price** fields (stacked, tappable). Set a bulk price lower than normal | Saved; shows on reopening |
| B-05 | Owner | Bulk orders screen: **Pause** card | A switch "Pause bulk orders" |
| B-06 | Owner | Turn **Pause ON**, confirm | Message "Bulk orders are paused" |
| B-07 | Customer | Account → **Bulk order** | The row says **Temporarily unavailable**. Opening shows a paused page and a **My bulk orders** button, not the menu |
| B-08 | Owner | Turn **Pause OFF** | "Bulk orders are open again" |
| B-09 | Customer | Account → **Bulk order** | Full menu opens, with counters on every dish (and Half/Full options) |

---

## ROUND 3 · Bulk request → quote → advance (Customer, Owner, Cook watching)

Use a **PICKUP order for tomorrow** first (simpler). Phone 3 (cook) just watches.

| # | Phone | Do | Expected |
|---|---|---|---|
| Q-01 | Customer | Pick Dal ×100, Paneer ×20. Choose **Pickup**, tomorrow, a time. Name/phone filled | The price updates live as you add dishes; bulk prices applied |
| Q-02 | Customer | Try **fewer than the minimum** (e.g. just 2 dishes) | A clear message about the minimum order; send button disabled or refused |
| Q-03 | Customer | Send the request | "Sent". It shows in **My bulk orders** as *Waiting for the shop's quote* |
| Q-04 | Owner | (at the same time) | **Slider** "new bulk order request", **sound**, and the **voice**. **No countdown bar** (it stays until you close it) |
| Q-05 | Owner | Tap **View** on the slider | Opens that bulk order |
| Q-06 | Owner | Change one unit price, add a note, **Send quote** | Quote sent |
| Q-07 | Customer | Phone gets a push "Quote received". Tap it | Opens the **bulk order page** (not a blank page) |
| Q-08 | Customer | Look at the quote | Total, **advance (50%)**, balance, the refund rule ("cancel at least 18 hours before…") |
| Q-09 | Customer | Tap **Ask for a change**, write a note, send | Owner gets a slider/notification; tapping it opens the order |
| Q-10 | Owner | Send a new quote | Customer is told |
| Q-11 | Customer | **Accept and pay ₹… now** → pay with Razorpay **TEST** UPI/card | Back on the order: **Confirmed**, advance paid shown |
| Q-12 | Owner | (at the same time) | Slider/notification "advance paid, order confirmed" opens the order |
| Q-13 | Customer | Tap the push "Order confirmed" | Opens the bulk order |
| Q-14 | **COOK** | (at the same moment as Q-11) | **Loud alert + voice + push:** "New bulk order. Wanted on <day> at <time>. Pickup. 100 Dal…" |
| Q-15 | COOK | Open the **Bulk** tab | The order is there, with a **BULK ORDER · code** badge, "Wanted on <date, time>", the dishes. It is **not** in *To make* yet (the day is far) |
| Q-16 | COOK | Leave the alert alone for a minute | The ringing **stops by itself** (goes to queue) |
| Q-17 | Customer | Orders tab (bottom) | A card with a **Bulk** label, the status, dishes, total, button **View** |
| Q-18 | Customer | Orders tab → chip **Bulk Order** | Only bulk orders listed |
| Q-19 | Customer | The bulk order does **not** show twice (no second "Order #…" card for it) | Only the Bulk card |

---

## ROUND 4 · The cook works the bulk order (COOK Phone 3, Owner Phone 2, Customer Phone 1)

| # | Phone | Do | Expected |
|---|---|---|---|
| K-01 | COOK | Bulk tab → on the card tap **Start cooking** | Card changes to *Cooking* |
| K-02 | Customer | Look at the bulk order | Status **Being made** (and a push "The shop is making your order") |
| K-03 | Owner | Bulk order page | Status updates **by itself** to *Preparing* |
| K-04 | COOK | Tap **Ready** | Card shows *Ready* |
| K-05 | Customer | Look at the bulk order | Status **Ready**; push "packed / ready" (pickup: "collect it at the time you chose") |
| K-06 | Owner | Bulk order page | Shows *Ready* without you touching anything |
| K-07 | Customer | Tap **Pay the balance … now** (test pay) | Balance paid; order shows balance paid |
| K-08 | Owner | Bulk order | Owner sees **balance paid online** |
| K-09 | Owner | Tap **Delivered / Handed over** | Customer gets the push; status **Delivered** |
| K-10 | Customer | After a moment | Status **Completed** and **View / Save invoice** buttons appear |
| K-11 | Customer | Open the invoice | A PDF/invoice with the bulk order code, the quote lines, GST if on |
| K-12 | Customer | Orders tab: the Bulk card now shows button **Order again** | Yes |
| K-13 | Customer | Tap **Order again** | The bulk menu opens with **the same dishes and quantities already filled**; day/time/address are asked again |

---

## ROUND 5 · Cook shortcuts and problems (new order, **COOK + Owner + Customer**)

Make a second bulk order (any size ≥ minimum), quote it, pay the advance (same as Round 3, quickly).

| # | Phone | Do | Expected |
|---|---|---|---|
| P-01 | COOK | New alert at payment | Loud alert + voice (as Q-14) |
| P-02 | COOK | Bulk tab → **Already made: mark Ready** (without pressing Start) | Goes straight to *Ready*. No error |
| P-03 | Customer | Look at the order | Status shows Ready (it can say being made/ready quickly one after the other) |
| P-04 | COOK | (third order) On a bulk card tap **Tell the owner about a problem** → *Dish finished* → choose a dish → Send | "Owner told" |
| P-05 | Owner | (at the same time) | Slider/popup "**Kitchen problem**" with sound; it names the order |
| P-06 | Owner | Answer with **Tell the customer** | Customer gets a polite note |
| P-07 | Customer | Tap that notification | Opens the **bulk order** page (not "order not found") |
| P-08 | Owner | (another problem) Answer **Cancel the order** | The **whole bulk order is cancelled**, and everything the customer paid online goes back (refund) |
| P-09 | Customer | Look at the order | Status **Cancelled by the shop**; refund message; a refund push |
| P-10 | COOK | Cooks' screen | The cancelled order disappears from *To make* and *Bulk* (an alarm sound for the cancel is normal) |

---

## ROUND 6 · The 24-hour rule (needs waiting; do it the day you start)

Pick the evening. You need two orders in total.

| # | Phone | Do | Expected |
|---|---|---|---|
| T-01 | Customer | Make a bulk order for **about 30 hours from now**; quote it, pay the advance | COOK gets the loud "New bulk order…" alert; it sits in **Bulk** tab only (not in To make) |
| T-02 | COOK | **About 6 hours later** (when it is 24 hours before the time) | A **second loud alert + push: "Bulk order to make for <day>"** and the order **jumps to the top of To make**, above any other order, with the BULK badge. It also stays in the Bulk tab |
| T-03 | COOK | Look at the card's clock | It does **not** say *Late* (a bulk order is late only after its own time passes) |
| T-04 | Customer | Make a bulk order for **only ~10 hours from now** (set notice hours to 1), pay the advance | COOK gets **one** alert saying "**Bulk order to make**" at once; it is straight in *To make* at the top |
| T-05 | COOK | After the wanted time passes without Ready | The card turns **Late** (red) |

---

## ROUND 7 · Bulk DELIVERY with the rider (COOK→RIDER on Phone 3, Owner, Customer)

Make a **delivery** bulk order (delivery, with your saved address) for later today or tomorrow; quote it; pay the advance. Use a rider that is **online**.

| # | Phone | Do | Expected |
|---|---|---|---|
| D-01 | Customer | The quote | Shows a **delivery fee** (or "free" as per rules) |
| D-02 | COOK | New alert; Start cooking → **Ready** (packed) | Ready |
| D-03 | Customer | Look at the order | *Ready* ("packed and will go out soon") |
| D-04 | Owner | Rider assigning mode **automatic**: a rider offer goes out when the cook marks Ready | The rider gets an offer (see D-05). In **manual** mode the owner gets "needs a rider" |
| D-05 | RIDER (log in on Phone 3 after the cook part) | Rider offer appears (card + sound) | Shows the order with the pay-per-delivery |
| D-06 | RIDER | Accept → trip page | Shows the customer address; **cash to collect = only the balance** (e.g. ₹5,000 for a ₹10,000 order with ₹5,000 advance) — **never the full amount** |
| D-07 | Customer | Look at the bulk order | A **Track the delivery** button appears |
| D-08 | RIDER | Pick up | Customer sees *On the way*; the **Track the delivery** button opens the live map/rider |
| D-09 | Customer | Tracking | Rider dot moves; "arriving soon" notification |
| D-10 | RIDER | Reach the door; enter the **PIN** the customer sees (if PIN is on) → mark delivered | Delivered |
| D-11 | Customer | Look at the order | *Delivered*, then **Completed**; balance shows **paid in cash**; invoice available |
| D-12 | Owner | Bulk order | Same final status; **balance cash collected** |
| D-13 | Owner | Rider cash screen | The rider holds **only the balance** in cash (not the full amount) |

**Variants (do at least one):**

| # | Do | Expected |
|---|---|---|
| D-14 | Customer pays the **balance online** before the rider arrives | Rider's page shows **nothing to collect** |
| D-15 | Owner presses **Balance received (cash)** before the rider arrives | Rider's page shows nothing to collect |
| D-16 | Rider unable to accept (nobody online) | Owner gets "**no delivery partner**" alert and can **assign by hand** |
| D-17 | Cook marks Ready **days early** for a delivery | **No rider offer yet.** Riders are asked about 2 hours before the time (long test, optional) |

---

## ROUND 8 · Cancelling and money (careful: use TEST money only)

| # | Phone | Do | Expected |
|---|---|---|---|
| M-01 | Customer | New bulk order, **before paying**, tap **Cancel this request** | Cancelled, no money |
| M-02 | Customer | Pay the advance, then tap **Cancel this order** a **long time before** (more than 18h ahead) | A popup shows the **exact refund** (full advance). Confirm → refund started; push "refund on its way" |
| M-03 | Customer | Pay the advance, order due **within 18 hours**, tap Cancel | Popup says the shop **keeps the advance** (shows the amount); cancels after you confirm |
| M-04 | Owner | Cancel a **paid** bulk order from the bulk screen with a reason | Customer gets **everything back**; push "shop cancelled" with the reason |
| M-05 | Owner | Open **Orders** (not Bulk): find the order called **"Bulk order <code>"** and **cancel it there** | The **whole bulk order cancels** and the customer is refunded, same as M-04 |
| M-06 | Owner | Same Orders list: try the **rider/cook** cancel buttons | They **cannot cancel** a bulk order (message says so) |
| M-07 | Owner | Razorpay test dashboard | Refund amounts match what the app said |
| M-08 | Owner | Home and Business report | A completed bulk order counts as **one** order (not two) |

---

## ROUND 9 · Reports

| # | Phone | Do | Expected |
|---|---|---|---|
| R-01 | Owner | **Business report** (last 7 days) after a completed bulk order | The big sales number **includes** it. Under it: "**Of this, from bulk orders**: ₹… · N orders · X% of your sales" |
| R-02 | Owner | Same report: if you have **no** bulk orders | That line is **absent** |
| R-03 | Owner | **Closing report** for today | "Includes bulk orders: N · ₹…" under the sales; the order is counted **once** |
| R-04 | Owner | Orders list / history | The hidden ticket does **not** appear as a second sale |

---

## ROUND 10 · Alerts and taps (does every tap open the right screen?)

For each, send the event, then **tap the notification (from the lock screen AND from the Notifications list)**.

| # | Phone | Event | Tap should open |
|---|---|---|---|
| N-01 | Owner | New bulk request | That bulk order |
| N-02 | Owner | Advance paid | That bulk order |
| N-03 | Owner | Customer cancelled | That bulk order |
| N-04 | Customer | Quote received / Stage change / Completed | The bulk order |
| N-05 | Customer | Refund started | The bulk order |
| N-06 | Customer | Shop's note after a kitchen problem | The bulk order |
| N-07 | Owner | A table booking (if booking is on) | Bookings |
| N-08 | Customer | Booking confirmed / paid / reminder | **My reservations** |
| N-09 | Owner | Pickup customer says "I'm coming / I'm here" | That order |
| N-10 | Owner | A table asks for the bill (dine-in) | The **Tables** screen |
| N-11 | Owner | Cook or rider goes on duty | That person's page |
| N-12 | Customer | Points earned | **My points** |
| N-13 | Customer | A normal order status update | That order |
| N-14 | Rider | An offer / assigned order | The **trip page** |
| N-15 | Cook | Leave approved/rejected | The **Leave** page |
| N-16 | Owner | Daily summary / weekly digest | Business page |

---

## ROUND 11 · Languages and voice (Hindi, Marathi, Gujarati, Bengali)

On the **Cook phone** (and then the Owner phone), change the app language in *Profile* and repeat one new bulk order:

| # | Do | Expected |
|---|---|---|
| L-01 | Hindi: cook alert at payment | Voice says "**नया बल्क ऑर्डर, 7 नवंबर, दोपहर 12:00 बजे के लिए, पिकअप…**" |
| L-02 | Marathi / Gujarati / Bengali: cook alert | Voice says the same in that language (the month name may stay English). Dish names stay as they are |
| L-03 | Bulk tab and card in each language | No English left except dish names and the code. Nothing cut off |
| L-04 | Customer app in Hindi: Bulk order screen, Orders card, **Order again**, the pause page | All translated, buttons fit |
| L-05 | Owner in Hindi: Bulk screen, pause card, reports card "Of this, from bulk orders" | Translated |
| L-06 | Cook push title in Hindi | "नया बल्क ऑर्डर, … के लिए" (the month may be English) |

---

## ROUND 12 · Breaking things on purpose (worth 10 minutes)

| # | Do | Expected |
|---|---|---|
| X-01 | Customer double-taps **Pay advance** quickly | Only **one** payment |
| X-02 | Customer closes the app right after paying, opens it again a minute later | Order shows **Confirmed** (not stuck) |
| X-03 | Airplane mode on the cook phone, then off | The Bulk tab refreshes by itself |
| X-04 | Owner and cook both press *Ready* | No error; nobody is confused |
| X-05 | Customer opens an old notification for a cancelled order | Opens the order and shows its state, no crash |
| X-06 | Customer pays the advance **after** the owner already cancelled the request | The money **comes back automatically** |

---

## When you report

Write: **the number**, the **phone**, and **what you saw**. For example:
- `Q-14 · Cook phone · rang but did not speak, only the push showed`
- `D-06 · Rider · it asked ₹10,000, not ₹5,000`
- `S-11 · Customer · the form was not greyed out`

If something was fine but looked ugly, add `(looks)`; if it is slow, add `(slow)`.
