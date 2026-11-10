# Browser notifications (web phase 6b)

## What it does
Every panel's **Alerts** screen (customer: Account > Alert sounds; owner, rider, cook, waiter: their Alerts) has, on the website only, a switch
**Also notify me on this browser**. It is **off by default**. Turning it on asks the browser for permission and subscribes it.

**The phone app has priority** (server rule, `notifications/channels/push.js`):
- a person with a phone app and a browser: the phone is always told; the browser is told **only while the switch is on**;
- a person with no phone app: the browser they switched on is the only place, so it is told;
- an alert the person switched off in the Alerts screen reaches neither; "sound off" for an alert sends the browser notification silently;
- a browser that the push service reports as gone is forgotten automatically.
- If the website is open and in front, nothing extra pops up (the live alert in the page already says it).
- A tap on a browser notification opens the same screen the phone app would (no voice: Soundbox is app-only).

## Setup (once) before it can work
1. Make the keys: `cd backend && node src/scripts/generateVapidKeys.js`. It prints three lines.
2. Put them in the **server environment** (Render > Environment, and `backend/.env` for local testing):
   ```
   VAPID_PUBLIC_KEY=...
   VAPID_PRIVATE_KEY=...      (a SECRET: never commit it or share it)
   VAPID_SUBJECT=mailto:you@yourcompany.in     (or https://yourcompany.in: a real contact for the push services)
   ```
3. Deploy the backend. Without these the website hides the switch (nothing breaks). Changing the keys later turns every browser's push off (they must switch it on again).
4. New dependency in the backend: `web-push` (`npm install` on deploy).
- No Firebase web settings are needed: this uses the standard Web Push protocol, separate from the phone's Firebase push.

## Limits to know
- **iPhone / iPad:** Safari only allows it for a website **added to the Home Screen** (Share > Add to Home Screen), iOS 16.4 or later. The switch explains this.
- The browser asks permission once; if the person blocked it, the switch tells them to allow it in the address bar.
- While testing on `localhost` the service worker is off (so reloads always run fresh code): open the page with `?pwa=1` to test push.
- The notification shows the shop's app icon (or its logo) and is worded in the person's language.

## Files
`backend/src/services/adapters/webPush.js` (the sender), `notifications/channels/push.js` (the rule), `routes/notificationRouter.js` (`GET /web-push`, `POST /web-push/subscribe`, `POST /web-push/unsubscribe`),
`models/DeviceToken.js` (webKeys) and `models/User.js` (alsoWebPush); `mobile/public/sw.js` (push + notificationclick), `mobile/src/utils/common/webPush.js`,
`mobile/src/components/common/BrowserPushCard.jsx`, `mobile/src/utils/common/push.js` (handleWebTap). Tests: `backend/tests/webPush.test.js`.

## Test list (Chrome on a computer, then an Android phone's browser, then an iPhone with the Home Screen)
1. Log in on the website (open it with `?pwa=1` while testing on localhost). Alerts screen: the card shows, switch off.
2. Switch on: the browser asks permission, allow. Switch stays on after a reload.
3. Close or minimise the tab. From another device place / change an order that alerts you: a notification appears with the shop icon.
4. Tap it: the website comes forward on the right screen.
5. With the phone app also logged in on the same account: switch OFF the card, trigger an alert: only the phone buzzes. Switch ON: both.
6. Block notifications for the site in the browser: the switch shows how to allow them again.
