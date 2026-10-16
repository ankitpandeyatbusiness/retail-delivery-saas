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
| 2 | Road route and arrival time (with a monthly cap and a straight-line fallback), arrival pushes, "reconnecting" when a rider goes quiet | next |
| 3 | Rider background service (foreground notification, GPS + socket with the screen off, permission and battery guide). Needs a new Android build | |
| 4 | Customer live-order bar and the draggable map sheet (full / half / minimised), polling fallback in the app | |
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

## The free Render server
Render's free plan goes to sleep after about 15 minutes with no requests, and a sleeping server has no sockets. Live tracking needs an awake server: a paid instance (about $7 a month) or an uptime pinger.

## Tests
`backend/tests/liveTracking.test.js` (12): socket ping to customer, late joiner, bad input and rate limits, fallback request, batched writes, 150 phones on one order, polling mode, the cap, the watchdog, the supreme-admin switch.
