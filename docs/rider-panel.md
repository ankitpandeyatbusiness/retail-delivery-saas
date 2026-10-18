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

## Not built yet (next phases)
Pay plans (salary / per delivery / percent / fixed plus distance / paid outside), earned vs paid, cash ledger and limit,
"Not received" complaint with the evidence panel, auto off duty, one device per rider, offline queue, SOS, battery guide.
