# Services, inquiries and table booking: what to do, and the phone test

Everything here was tested by the computer (about 230 tests), but **never on a real phone or with real Razorpay keys**. This page is the checklist for that.

## Before you start (about 10 minutes)

1. **Backend:** deploy and restart it. Nothing to install and no new settings in `backend/.env`. The new database tables and their locks build themselves on the first start.
2. **Apps:** the customer/owner app and the superadmin app need a new build or update. No new phone permissions or native parts were added (the payment sheet, the PDF sharing and the photo picker are the ones the app already had), so an update over the air should be enough. If the Alerts do not show "Service inquiries" or "Table bookings", install the new build.
3. **Switch the features on for ONE test shop** (they are off for every shop): superadmin app → Shops → the shop → **App features** → *Add-ons* → switch on **Services and inquiries** and **Table booking**.
4. **Razorpay:** the shop must have its own Razorpay keys saved and tested (Shop → Payments). Use **test keys** first. Without them the owner cannot switch table booking on, and guests cannot book.
5. Have two phones if you can: one owner, one customer. A third phone makes the "two people book at once" test easy.

## Owner phone

**Services** (Shop hub → Menu and offers → Services)
- [ ] Add Bulk Order from the list. Open it: the recommended questions are there. Change the price (e.g. ₹1000 per plate), add a photo and two bullet points. Save.
- [ ] Add "My own service" ("Cake order"). Add three of your own questions: a date, a yes/no, a pick-one with three choices. Move one up, duplicate one, delete one.
- [ ] Tap **Use recommended settings**: it asks first; your own questions stay.
- [ ] The service slider (LIVE/OFF): turn one OFF and check it disappears on the customer phone.

**Inquiries** (Shop hub → Inquiries)
- [ ] When the customer sends one: the slider appears, and the voice says it in English and then Hindi. The Alerts screen has "Service inquiries" with the four switches.
- [ ] Open it: the answers, the estimate (guests × price), Call and WhatsApp buttons. Reply, use a quick reply, mark Quoted/Confirmed, save a private note.
- [ ] Leave one unanswered: after the delay (24 hours, or what the superadmin set) you get one reminder.

**Table booking** (Shop hub → Bookings → Booking settings)
- [ ] Try the slider before anything is set: it refuses and says what is missing.
- [ ] Press **Add my N dine in tables**; set seats per table; add a lunch time and a dinner time; set a deposit (e.g. ₹200 per person) and "Taken off the bill". Save, then switch it on.
- [ ] Close one day, and one time, in "Close a day or a time".

## Customer phone

**Services:** Account → Services → open one: photos, price, bullets, then the form. Name and phone are filled in. Tap a message chip. The estimate changes with the guests. Send. See it in **My inquiries**; read the owner's reply and answer.

**Booking a table:**
- [ ] Account → Book a table. Pick tomorrow, 4 guests, a time. The table map shows free and taken tables; a table too small for 4 is dim.
- [ ] Tap a table → **Pay ₹800 deposit** → pay with a Razorpay **test** UPI/card. You land in My bookings with the code.
- [ ] The owner gets the slider and the voice (English then Hindi). Tap **Allow** on the slider: the customer gets "confirmed" and the **table card** stays above the tabs until the slot is over.
- [ ] Start a booking and DON'T pay: after 10 minutes the table is free again for others. "Pay deposit" on My bookings finishes it before that.
- [ ] Half an hour before the slot, both phones get the reminder (the owner's has the voice).
- [ ] Download the **receipt** on both phones.

**Cancel and money**
- [ ] Cancel a booking well before the time: the deposit is refunded (check the Razorpay dashboard). Cancel too late: the deposit is kept (the screen tells you before).
- [ ] Owner **Deny** with a reason: the guest gets the standard text plus your reason, and the full refund starts at once (the bank may still take a few days).

**At the restaurant**
- [ ] Booker scans the QR of the booked table, orders ₹1000 of food. The bill shows "Table booking amount paid earlier −₹800", **To pay ₹200**. Pay online or at the counter. The bill PDF states the booking amount.
- [ ] After he pays and the table is freed, a second phone can book the same table for the rest of the slot. (Or the owner taps "Guest left: table is free now".)

## The races (three phones)

- [ ] Two guests tap the SAME table at the same moment: one pays, the other sees "table X was just taken" and the map refreshes.
- [ ] One guest, two phones, same time: the second is refused or gets his own held booking back, never two tables.
- [ ] Fill every table of a time. A guest taps that time: "Join the waitlist". Cancel one booking: the waiting guest gets a push.

## Superadmin phone

- [ ] More → **Services and booking**: totals, the booking money (collected / refunded / kept / taken off bills), and a row per shop. Tap a shop; read an inquiry thread. There is no reply box.
- [ ] More → Services and booking → **Starter services and the reminder**: change the reminder hours and a quick-reply text; add a new Bulk Order on the owner phone and see the new text.
- [ ] Switch **Table booking** off for the shop: guests no longer see "Book a table", existing bookings still work and can be cancelled.

## Languages

Change the app language (Hindi, Marathi, Gujarati, Bengali; Bhojpuri shows Hindi) and look at: the Services and booking screens, the table map, the owner's Bookings and settings. Look for text that is cut off or overflows. **Not translated:** the push notification texts the server sends (they go out in English, as before), and the superadmin app (English only, by decision).

## Known limits

- A booking lasts one slot length (the owner sets it). A guest who never turns up keeps the table until the slot ends unless the owner marks a no-show.
- If the guest sits at a different table than the booked one, the booking and the deposit still count for his visit.
- The waitlist does not hold a table: the first guest to book gets it.
- "Instant" refunds depend on the guest's bank; Razorpay may take a few days.
- The booking receipt is a receipt, not a GST tax invoice. Ask your CA whether the deposit needs its own invoice.
- About 1,500 older texts in the apps still have no translation and show in English. Nine old tests (queue timing and Transactions) fail on the committed code too and are not related to this feature.
