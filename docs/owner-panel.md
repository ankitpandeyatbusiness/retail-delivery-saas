# Owner panel (shop admin) inside the customer app

One app, three panels, chosen by the phone number's role: a customer gets the shop tabs, a `rider` gets the delivery
screen, an `admin` (the shop owner) gets the owner panel. Code lives next to the customer code, in `owners/` folders:
`mobile/src/{screens,components,api,store,utils,hooks}/owners/`.

The shop's own logo, colours, font and light/dark look are used everywhere (`useBrand()`), so the owner feels he is in his
own app. Every owner screen talks to `/api/shop/*` (the same routers the superadmin reaches through
`/api/admin/tenants/:tid/shop/*`). API wrappers: `mobile/src/api/owners/shopApi.js` (one function per endpoint).

Related: `docs/owner-soundbox.md` (the new-order alert, built first).

## Plan and status

| Phase | Scope | Status |
|---|---|---|
| 0 | Role routing, owner tabs, UI kit, API layer, Soundbox | done |
| **1** | **Home dashboard, Orders board, order detail, pause orders** | **done (written; needs a device run)** |
| 2 | Menu: categories, items, stock, photos, collections | next |
| 3 | Riders, live map, cash on delivery, performance, rider rules | |
| 4 | Money: sales, payments, refunds, SMS wallet, rent | |
| 5 | Hub: customers, complaints, offers, messages, reviews | |
| 6 | Settings: hours, delivery area and fee editor, COD limit, activity log | |
| 7 | Growth: insights, win-back, scheduled orders, KOT, staff accounts | |

Tabs: **Home · Orders · Menu · Riders · Money**. Everything else is in the **Shop hub** (tap the shop logo).
Access levels enforced by the server (and shown as a banner): normal / rent unpaid (menu and settings locked, orders, riders,
money open) / panel blocked by the platform (only orders in progress, rent, notifications).

## Phase 1 in detail

### Home (`OwnerHomeScreen.jsx`)
One call, `GET /api/shop/dashboard`, fills it; it refreshes when an order changes (socket `order:update`) and on focus.
Top to bottom: a **Silence** button while a real order rings; "Orders are paused" with **Start**; "N new orders waiting"
with the countdown to the automatic cancel; **Today** (sales, delivered, average order, change vs yesterday up to the same
time, sales by hour, placed / cancelled and the money lost, average time to accept); the order pipeline (tap a stage to
open that chip on the board); riders; **Needs your attention** (out of stock, running low, complaints, SMS balance, rent
due, cash with riders); Soundbox status; the latest feed lines.

### Orders board (`OwnerOrdersScreen.jsx`, `useOrdersStore.js`)
Chips (Active, New, Accepted, Preparing, Ready, On the road, Delivered, Cancelled) with live counts, search by order
number, infinite scroll, pull to refresh. Each **order card has Accept / Reject right on it**; later stages show the next
step. Unaccepted orders sort first, oldest first (they expire).

### Order detail (`OwnerOrderScreen.jsx`)
Items with options and notes, the customer's instructions, the bill, customer (Call, WhatsApp), address (Open in Maps),
the delivery rider (status in words, rider problems, assign / change / remove, call, where is he), the timeline, the
invoice PDF (after delivery), "Mark as not delivered" (the server allows it 15 minutes after the rider's first problem; the
screen counts down), and an action bar that is always in reach. Opening an order stops its new-order alert.

### Rules the app follows (do not duplicate them, ask the server)
- Which step comes next, and whether cancel / "not delivered" is allowed: `order.allowedNext` (backend `services/orderflow.js`).
  Delivery orders: placed, accepted, preparing, out for delivery, delivered. Pickup and dine-in: placed, accepted, preparing,
  ready, delivered. The app only names the steps (`utils/owners/orderFlow.js`).
- **Reject needs a reason**: busy, out of stock, shop problem, customer asked, or **Other with the owner's own typed words**
  (at least 3 letters). Any reason can also carry a note. "Not delivered" asks who was at fault: customer, shop, rider.
- An order nobody accepts is cancelled by the server after `ORDER_ACCEPT_TIMEOUT_MIN` (default 10) minutes, with reminders at
  3 and 6. Every waiting order carries `acceptBy` (the moment it will be cancelled); the app shows a countdown.

### Pause orders (timed pause)
The status line under the shop name opens a sheet: 30 minutes, 1 hour, 2 hours, until tomorrow morning (4 AM India time),
until I start again, or **Start taking orders now**. `PUT /api/shop/accepting-orders`:
`{acceptingOrders:true}` · `{acceptingOrders:false}` · `{acceptingOrders:false, pauseMinutes:30}` ·
`{acceptingOrders:false, untilMorning:true}`. A timed pause stores `settings.orders.pausedUntil` and leaves the on/off switch
ON; `resolveConfig()` (backend `tenantConfigService.js`) treats the shop as paused until that time and as open after it,
so **nothing has to run at the moment it ends** and a forgotten pause cannot lose a day of sales. A save from the superadmin
panel keeps it (`utils/keepOwnerPause.js`); the superadmin sees it as "Owner paused" with the end time (`utils/shopState.js`).

## Backend added in Phase 1
| What | Where |
|---|---|
| `GET /api/shop/dashboard` (open while rent is unpaid, like `/live`) | `routes/shopRouter.js`, `services/dashboardService.js` |
| Timed pause | `routes/shopRouter.js`, `services/tenantConfigService.js`, `utils/keepOwnerPause.js`, `utils/shopState.js` |
| `acceptBy` on every waiting order | `services/orderTimeout.js` (`acceptDeadline`), `routes/shopRouter.js` (`view`) |

"Sales" always means **delivered** orders counted on the day they were delivered (same rule as the sales report):
food + packaging - discount. Delivery fee, tax and tips are not the shop's sales.

## Files (mobile)
| File | Role |
|---|---|
| `screens/owners/OwnerHomeScreen.jsx`, `OwnerOrdersScreen.jsx`, `OwnerOrderScreen.jsx` | the three Phase 1 screens |
| `components/owners/ui.jsx` | cards, buttons, chips, option rows, **Sheet**, text field, header with the **pause sheet** |
| `components/owners/orderBits.jsx` | order card, status pill, countdown, `useOrderActions` (accept / reject / not delivered), reason sheet, rider sheet, call / WhatsApp / maps / invoice |
| `store/owners/useOwnerStore.js` | live picture, dashboard, billing, access state |
| `store/owners/useOrdersStore.js` | the board's list, counts, paging, patching an order in place |
| `utils/owners/orderFlow.js` | labels, reasons, filters, time and money wording (pure functions) |
| `hooks/owners/useNow.js` | a ticking clock for countdowns |

## Testing
Backend: `node --test --test-concurrency=1 --test-force-exit tests/ownerHome.test.js` (timed pause, dashboard, `acceptBy`).
Run the whole suite with `npm test` in `backend/`.
App: run a development build (`npx expo run:android`), log in with an owner number; place orders from a customer phone
(or the seed shop) to see them arrive. Pure helpers can be checked with Node (they have no React in them).

## Not done yet (known)
- The owner's bell still reads the customer inbox route; the owner inbox is `GET /api/shop/notifications` (Phase 6).
- Menu, Riders, Money tabs and the Shop hub destinations are placeholders until their phases.
- Phase 1 has not been run on a device at the time of writing: expect small layout fixes on first run.
