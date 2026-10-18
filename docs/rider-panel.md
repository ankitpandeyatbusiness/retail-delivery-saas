# Rider panel (phase 1, built 2026-10-18)

A rider here belongs to ONE shop and was added by its owner, so the app is not a marketplace: no shop maps, no KYC in the app,
no surge. Three tabs (Home, History, Profile) and one delivery page.

## What the rider sees
- **Home:** Start / End duty, today's deliveries (and earnings if the shop tracks pay), cash he holds, a **new order card**
  (what it pays, distance, cash to collect, a countdown, Accept) and the deliveries he carries.
- **Delivery page** (one big button at a time): Collect -> I have collected the order; On the way -> Navigate / Call, I have arrived;
  Deliver -> Deliver (PIN, or a photo when the shop has no PIN). Small links: Problem, I cannot do this delivery (before pickup only).
- **Cash order paid by QR at the door:** "Customer will pay online" shows a QR for the exact amount; when paid the screen turns to
  "Paid" and no cash is expected.
- All words are in `mobile/src/utils/riders/riderText.js` (English now; a second language later is one more object).

## Backend (`/api/rider`)
| Route | What it does |
|---|---|
| `GET /orders?tab=offered\|active\|history` | each order has `distanceKm` (shop to customer), `earnPaise`, `destination` (after accepting), `doorPay` |
| `POST /orders/:id/arrived` | keeps `delivery.arrivedAt` (once) |
| `POST /orders/:id/release {note}` | before pickup only: back to the other riders (the releaser is skipped), owner told |
| `POST /orders/:id/deliver {pin?, lat?, lng?, farOk?}` | checks he is within 300 m of the customer's pin; farther: `409 TOO_FAR`, retry with `farOk: true`; the spot is saved in `delivery.deliveredPoint` and a flag goes to the owner's live feed. No position at all is allowed and flagged `noGps` |
| `POST /orders/:id/door-pay`, `GET /orders/:id/door-pay` | start the QR (the shop's own Razorpay, single use, fixed amount) / ask if it was paid |
| `GET /me` | now includes `shopPhone` |

**Door payment** (`services/doorPayment.js`): paid = `payment.method` becomes `upi`, `payment.status` `paid`, `payment.paidAtDoor` true,
an `OnlinePayment` row is made (refunds work as for any online order), no cash ledger row. The `qr_code.credited` webhook of the
shop's account and a direct ask to Razorpay both end in the same `credit()` (safe to repeat). A second payment for an already paid
order, a wrong amount or a foreign QR pay nothing and alert the superadmin. Taking cash after all closes the QR.

## Phase 2: pay plans and cash (built 2026-10-18)
**One plan for the shop, an own plan for a single rider** (`services/riderPay.js`; amounts in rupees; the delivery's pay is copied onto the order, so a plan change never touches old deliveries):

| Plan | A delivery earns |
|---|---|
| `none` (paid in hand) | nothing is kept; the rider sees no earnings at all |
| `salary` | nothing per delivery; the rider sees the salary (every day, week or month) |
| `per_delivery` | a fixed amount |
| `percent` | that percent of the order total |
| `distance` | a base + an amount per km beyond a free distance (straight line shop to customer; unknown distance = base only) |
| `salary_plus` | a salary AND an amount per delivery |

- **Owner:** Delivery rules > "How do you pay your riders?" (shop plan), the rider's own page > Pay (his own plan or "same as the shop").
  Settings under `settings.riders`: `pay`, `trackPayouts`, `payUndelivered` (pay when the food was collected but not delivered, default off), `cashLimit` (rupees, 0 = none). The old single `payPerDelivery` still works until a plan is chosen.
- **Recording payments is optional** (`trackPayouts`): the owner writes down what he paid (`POST /api/shop/riders/:id/payments`, kinds `earnings`, `advance`, `salary`, `bonus`; a wrong entry is cancelled with a reason, never deleted). What a rider is "still to get" = earned since tracking was switched on minus `earnings` and `advance` payments; older deliveries never count. Salary and bonus payments do not reduce it.
- **Rider Money tab** (`GET /api/rider/money`): cash he holds, the limit and the recent entries; earnings and payments only when the shop tracks pay.
- **Cash limit:** a rider whose cash on hand has reached `cashLimit` is skipped by automatic assignment and by the broadcast to free riders, and cannot accept an old broadcast offer ("Give it to the shop first"). The owner can still assign him by hand. The rider sees a bar and a warning from 80 %.
- The superadmin's rider settings no longer edit pay; they say the owner sets it.

## Phase 3: "I did not get this order" (built 2026-10-18)
- **Customer:** on a delivered order (within 24 hours) a red button "I did not get this order", one question, no form. It makes a complaint of type `not_received`.
- **Evidence for the owner** (`complaintService.deliveryEvidence`, copied at the moment of the complaint so it cannot change later; the customer never sees it): who marked it delivered (rider, owner or platform), when; how it was confirmed (`pin`, `photo`, `shop` = the shop completed it, or `none`); the rider's spot at delivery against the customer's pin (distance, far, no GPS); collected and arrived times; the cash collected on a cash order; and how many times THIS customer said "not received" before and how many were refused.
- **The owner decides** as for any complaint (reply, full or part refund, no refund; an online order is refunded automatically, a cash order is only noted) and answers one extra question, "Was the rider at fault?". "Yes" counts once on the rider (`Rider.faultCount`, shown on his page). For a cash order the owner uses the rider's "Correction" if he should pay the money back.
- Not stored: the rider's live path (it is kept only in memory while he rides).

## Not built yet
Auto off duty, one device per rider, offline queue, SOS, battery guide.
