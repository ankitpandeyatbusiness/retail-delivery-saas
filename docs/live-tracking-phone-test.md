# Live tracking: phone test checklist

Nothing in live tracking has been run on a real phone yet. Do this list once, in order. Tick each line; write down what failed.

## 0. Before you start
- [ ] **Server awake.** Free Render sleeps after 15 minutes. Open `https://<your-server>/api/tracking/mode` in a browser. It must answer `{"mode":"socket",...}`. If it takes 30+ seconds the server was asleep; ask again.
- [ ] **Google routes (optional).** In the server's environment: `ROUTES_PROVIDER=google` and `GOOGLE_ROUTES_API_KEY=<a key with the Routes API on>`. Without them everything works with a straight-line estimate (the line is dashed).
- [ ] **New Android build.** The rider side needs new permissions, so build once: `eas build` for the shop (or `npx expo run:android`). An OTA update is not enough for Phase 3. The customer and owner parts are JavaScript only.
- [ ] **Three phones (or two phones and a second login):** a customer, a rider, the shop owner. Same shop.
- [ ] Rider Rules (owner app): Live tracking is **on**; "Rider sends his location every" 10 seconds.

## 1. Set up a delivery
1. Customer: place a **delivery** order (real address with a map pin).
2. Owner: accept it and assign the rider.
3. Rider: accept, then **Picked up**.
- [ ] Customer phone: within a few seconds a **bar** appears above the tabs: "On the way" or "Arriving in N min".

## 2. The rider's phone (Phase 3)
- [ ] On the first order the rider sees the explanation, then Android asks for location. Choose **Allow all the time** (if it only offers "While using the app", tap it, then Settings > Location > Allow all the time).
- [ ] A notification "Delivering your orders" appears in the status bar.
- [ ] **Lock the rider's phone** and walk or ride about 300 m. The customer's map keeps moving.
- [ ] **Swipe the app away** from recents. The notification stays; the customer's map keeps moving.
- [ ] Switch the rider's mobile data off for 1 minute: the customer bar says **Reconnecting to your delivery partner**; the owner's order page shows an amber warning. Data back on: it clears by itself.
- [ ] After about 3 minutes of silence the owner gets a push "Rider not reporting".
- [ ] Mark the order **Delivered** (with the PIN). Within a minute the rider's notification disappears.
- [ ] Log out as the rider while an order is on the way: the notification disappears at once.
- [ ] If a phone stops sending with the screen off (Xiaomi, Oppo, Vivo, Realme, Samsung): Settings > Apps > this app > Battery > **Unrestricted / No restrictions**, and allow **Autostart**. Test again.

## 3. The customer (Phase 4)
- [ ] Tap the bar: a map opens at half height with the road line, the bike pin, your home pin, the rider's name and the **delivery PIN**.
- [ ] Drag the handle up: full screen. Drag it down: half, then back to the bar. The Android Back button shrinks it too.
- [ ] The bike **turns** in his direction and slides, it does not jump.
- [ ] Move the map with your finger: it stops following. Tap the centre button: it follows again.
- [ ] Order page: the **Open live map** button opens the sheet.
- [ ] Tap targets: tap the bar at its far left and far right edges, and the buttons. They must respond anywhere (an earlier phone only reacted to text and icons).
- [ ] Lock the customer's phone for 5 minutes, then look: a notification "Arriving in about N min - <rider> is bringing order #..." with no sound. It **replaces itself** (still one notification) as the time changes.
- [ ] 3 minutes away: the "Arriving in about N min" push, then at about 80 m "<rider> has reached". Each once. Still only one notification line for this order.

## 4. The owner (Phase 5)
- [ ] Order page (out for delivery): live map with the road line, a chip "12 min - 3.4 km", a centre button.
- [ ] Rider silent for 90 seconds: amber warning with "You can call him"; **Call the rider** works.

## 5. The server under load (Phase 6)
- [ ] **Superadmin app > More > Live tracking** shows phones connected, riders sending, route use.
- [ ] Switch to **Polling** (supreme admin only). Within a few seconds the customer map keeps updating, now slightly slower (every ~15 s); the rider keeps sending by the web fallback. Switch back to **Live**: phones return to the socket within a minute or two.
- [ ] Switch to **Off**: the customer sees no live rider; deliveries still work. Switch back.
- [ ] From your computer: `cd backend && node tests/load/trackingLoad.js --riders 30 --watchers 10 --seconds 30` ends with `VERDICT: OK`. Run it again with `--cap 100` to see connections refused at the cap (they would poll).

## 6. What to send me if something fails
The phone make and Android version, which step, what you saw, and (for the rider side) whether the status-bar notification was there.
