# Maps on the website (web phase 6a)

On the web build `react-native-maps` is replaced by **Google Maps JavaScript API** (`mobile/src/web/shims/maps.js`, helpers in `mapMath.js`).
All 10 map screens work through the same names: `MapView` (regions, `fitToCoordinates`, `animateToRegion`, `animateCamera`, pan / region callbacks,
custom map style), `Marker` with any React content (shop pin, home pin, scooter) incl. `anchor`, `rotation`, `onPress`, `Marker.Animated` (the rider
glides between positions), `Polyline` (solid and dashed, white edge) and `Circle`. The phone app is unchanged.

## Key (a BROWSER key, not the server keys)
- Env name: `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` in `mobile/.env` (it is written into the website's JavaScript, so anyone can read it: lock it down).
- Google Cloud > APIs & Services > Credentials > this key:
  - **Application restrictions: Websites (HTTP referrers)**: `https://*.vivyaan.co.in/*` and `https://vivyaan.co.in/*` (add a client's custom domain here when you add one). For testing also `http://localhost:8081/*`.
  - **API restrictions: Maps JavaScript API** only.
- Do not reuse the server keys (`GOOGLE_PLACES_SERVER_KEY`, `GOOGLE_ROUTES_SERVER_KEY`) or the phone SDK key in the browser.

## Cost
Each time a screen shows a map it is one "map load" (Maps JavaScript API, Dynamic Maps). Check the free allowance in the console and set a **daily quota** on the Maps JavaScript API plus a budget alert, the same way as for the other Google APIs
(see the Google Maps budget notes). The server's staged / capped route calls are unchanged: the website uses the same routes the phone uses.

## Without the key, or if Google refuses to load
A grey box with "Map is not available right now" shows; nothing crashes.

## Test list (a browser, logged in)
1. Cart > add / change address: the map opens, drag it: the pin address follows; "use my location" asks the browser for permission.
2. An order out for delivery (Growth / Pro shop): the customer's live map shows the shop pin, the home pin, the road line, and the rider moving smoothly.
3. Owner: shop area map and the pin map in Shop settings; the all-riders live map (tap a rider).
4. Rider (website): the trip map. (Background GPS is app-only; the map still shows.)
