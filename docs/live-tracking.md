# Live tracking of riders (Blinkit style): plan and status

## The idea
```
Rider's phone ──socket (rider:ping)──▶ Server ──socket (rider:location)──▶ customer + owner apps
```
No timer polling in the live path. If a socket cannot be used, the apps poll lightly instead; the server decides when.

## Phases
| Phase | What | Status |
|---|---|---|
| 1 | Server foundation: socket ping from the rider, memory + batched database writes, last position on join, connection cap, degraded mode, kill switch, tests | **done** |
| 2 | Road route and arrival time (with a monthly cap and a straight-line fallback), arrival pushes, "reconnecting" when a rider goes quiet | **done** |
| 3 | Rider background service (foreground notification, GPS + socket with the screen off, permission and battery guide). Needs a new Android build | **done (code); needs a new build and a phone test** |
| 4 | Customer live-order bar and the draggable map sheet (full / half / minimised), polling fallback in the app | **done (code); phone test pending** |
| 5 | Lock-screen notification updated by push, owner map polish and quiet-rider warning | |
| 6 | Load test script, superadmin screen for the switch, phone test checklist | |

## Phase 1: how it works
- **Rider to server:** `emit('rider:ping', { lat, lng, heading?, speed?, accuracy? }, ack)` on the rider's socket. The web request `POST /api/rider/location` is the fallback and goes through the same code (`services/liveTracking.js`). Rules: a position is kept only while the rider has an order on the way (`out_for_delivery` and picked up) and the shop's live tracking is on; pings closer than 2 seconds are dropped; a socket may send at most one ping per 1.5 seconds (a bucket of 20).
- **Server to apps:** each accepted ping is sent at once to the room `order:<id>` as `rider:location { orderId, lat, lng, heading, speed, accuracy, at, seq }`. The direction (`heading`) is worked out from the last two points when the phone does not send one.
- **Joining late:** when someone joins an order's room (`order:join`) the last known position is sent to that socket at once.
- **Database:** the newest position of every rider lives in memory. A timer writes the changed ones in one batch at most every 10 seconds per rider. The order tracking page and the owner map read the live (memory) position first, so they are never behind. When the last order of a rider ends, his position is forgotten.
- **Protection** (`services/trackingGuard.js`):
  - New sockets are refused with the error `SERVER_BUSY` (or `TRACKING_OFF`) and `err.data { mode, pollSec, retryAfterSec }` when the mode is not "socket" or the socket cap (default 400) is reached. A superadmin socket is never refused.
  - A watchdog watches the event loop (answers 300 ms late three times) and memory (above 85%). If the server struggles it switches to polling by itself for 2 minutes, then returns.
  - When the mode changes every connected app gets `tracking:mode { mode, pollSec }`.
  - `GET /api/tracking/mode` (public, cheap) tells a phone what to do even when a socket cannot connect: `{ mode, pollSec, retryAfterSec }`.
  - Superadmin: `GET /api/admin/platform/tracking` (everyone, shows sockets, riders live, counters) and `PUT` (supreme admin: `{ mode: socket|polling|off, maxSockets, pollSec }` or `{ reset: true }`).
- **What the apps must do** (Phase 4 and 3): connect with a growing, randomised delay; on `SERVER_BUSY` / `TRACKING_OFF` / `tracking:mode polling` poll the tracking page every `pollSec` seconds (the rider keeps using `POST /api/rider/location`); try the socket again after `retryAfterSec`.

## Phase 2: route, arrival time and alerts (`services/tripEta.js`, `services/adapters/routes.js`)
- **Route:** asked for once when the order is picked up (the rider's first ping), again only if he leaves the road (150 m away on two pings in a row, not sooner than a minute after the last route) or the route is 10 minutes old. In between, the arrival time is worked out from how far along the route he is, so there is no call per ping.
- **Source:** `ROUTES_PROVIDER=google` in `backend/.env` uses Google's Routes API (two-wheeler, no live traffic, which keeps it in the cheapest tier). Anything else, or any problem, gives an **estimate** (straight line x 1.3 at 20 km/h). The server needs its **own** Google key (not the app-restricted one) with the Routes API turned on: `GOOGLE_ROUTES_API_KEY` (falls back to `GOOGLE_MAPS_API_KEY`).
- **Guard rails:** a monthly cap on Google calls (default 8000, set by the supreme admin: `PUT /api/admin/platform/tracking { routeCap }`); after the cap the estimate is used and nothing is billed. After 3 failures in a row Google is left alone for 5 minutes. Every call has a 4-second limit.
- **Events to everybody watching the order:** `rider:route { polyline, distanceM, durationSec, source }` when a route is made (the polyline is Google's text format; the app decodes and draws it; with source "estimate" the app draws a straight line from the rider to the address), `order:eta { etaAt, remainingM, remainingSec, source }` at most every 5 seconds, `rider:quiet` when his phone has been silent for a minute. Someone who opens the map gets the position, route and arrival time at once.
- **Pushes:** "Arriving in about N min" (3 minutes or 600 m away) and "has reached" (80 m), each once per order (saved on the order). The owner is told once when a rider has been quiet for 3 minutes.
- **The polling path:** `GET /api/orders/:id/tracking` now also returns `route`, `remaining { meters, seconds }`, `riderQuiet` and `etaSource: "route"` when a route is known.
- Tests: `tests/tripEta.test.js` (10).

## Phase 3: the rider's phone with the screen off ()
- **How:** when the rider has an order on the way the app starts an Android **foreground service** (expo-location + expo-task-manager). A small notification ("Delivering your orders - sharing your live location") stays in the phone while it runs. Android allows GPS with the screen off or the app swiped away only with that notification.
- **Sending:** each GPS reading goes over the socket () when the app's socket is connected, otherwise as  (after a swipe-away there is no socket, so this path is used; the server rules are the same). The server answers with the shop's interval (, the owner's Rider rules); the task sends no faster than that.
- **Stops:** by itself after 3 answers in a row of "no order on the way" or "tracking off"; when the rider logs out.
- **Permissions:** the app explains first, then asks "Allow all the time". If he refuses it still works while the app is open, and he is shown how to switch it on (Settings, and Battery: Unrestricted). Some makes (Xiaomi, Oppo, Vivo, Realme, Samsung) also kill background apps unless the app is set to "No restrictions" / "Autostart".
- **Needs a new native build** (new permissions and the service): , , . An OTA update is not enough. Google Play will ask for a background-location declaration with a short video when you publish.

## Phase 3: the rider's phone with the screen off (`mobile/src/utils/riders/locationTask.js`)
- **How:** when the rider has an order on the way the app starts an Android **foreground service** (expo-location + expo-task-manager). A small notification ("Delivering your orders - sharing your live location") stays in the phone while it runs. Android allows GPS with the screen off or the app swiped away only with that notification.
- **Sending:** each GPS reading goes over the socket (`rider:ping`) when the app's socket is connected, otherwise as `POST /api/rider/location` (after a swipe-away there is no socket, so this path is used; the server rules are the same). The server answers with the shop's interval (`everySec`, from the owner's Rider rules); the task sends no faster than that.
- **Stops:** by itself after 3 answers in a row of "no order on the way" or "tracking off"; and when the rider logs out.
- **Permissions:** the app explains first, then asks "Allow all the time". If he refuses it still works while the app is open, and he is shown how to switch it on (Settings, and Battery: Unrestricted). Some makes (Xiaomi, Oppo, Vivo, Realme, Samsung) also kill background apps unless the app is set to "No restrictions" / "Autostart".
- **Needs a new native build** (new permissions and the service): `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`. An OTA update is not enough. Google Play will ask for a background-location declaration (with a short video) when you publish.

## Phase 4: what the customer sees (`mobile/src/components/customers/LiveOrderHost.jsx`)
- **The bar:** while a delivery is on its way a small bar sits above the tabs ("Arriving in 8 min", the rider's name, how far away). Tap it to open the map. It is hidden on Cart, Item, Order placed, Order detail and Login.
- **The sheet:** opens half screen with the map on top and the rider and delivery PIN below. Drag the handle up for full screen, down to shrink back to the bar; the Back button shrinks it too. The Order page has an "Open live map" button.
- **The map:** the road line from the route, the bike pin turning in the direction he travels and sliding between pings, the address pin, and a button to centre again (the map stops following when the customer moves it himself).
- **Quiet rider:** when his phone goes quiet for a minute the bar says "Reconnecting to your delivery partner".
- **Socket first, polling when asked:** the app joins the order room and listens to `rider:location`, `rider:route`, `order:eta`, `rider:quiet`. If the socket is down or the server is in polling mode it fetches `GET /orders/:id/tracking` every `pollSec` seconds (15 by default); with a healthy socket it fetches only every 40 seconds as a safety net.
- The tracking page now also returns `destination { latitude, longitude }`.
- Not done: calling the rider (only a masked number is held for the customer); that needs a masked-call decision.

## The free Render server
Render's free plan goes to sleep after about 15 minutes with no requests, and a sleeping server has no sockets. Live tracking needs an awake server: a paid instance (about $7 a month) or an uptime pinger.

## Tests
`backend/tests/liveTracking.test.js` (12): socket ping to customer, late joiner, bad input and rate limits, fallback request, batched writes, 150 phones on one order, polling mode, the cap, the watchdog, the supreme-admin switch.
