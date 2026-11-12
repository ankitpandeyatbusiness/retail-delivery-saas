# Smart table QR

A table sticker holds one short permanent address: `https://<QR address>/q/t/<shop>/<table>` (set `QR_BASE_URL` on the server to your own domain). The server decides what the guest sees.

## What the guest sees
| Guest's phone | Store link filled? | What happens |
|---|---|---|
| Computer | – | The shop's website opens at once. |
| Android, app installed | – | The app opens on that table. |
| Android, app not installed | Play Store link filled | The page shows **Open in the store** and **Continue in browser**. |
| Android, app not installed | Play Store link empty | The website opens at once. |
| iPhone / iPad | the same, with the App Store link | |

A phone type whose store link is empty goes straight to the website, even when the other type has a link.

**Android keeps the table.** The Play Store link carries the table (Play "referrer"). After the guest installs the app and signs in with the OTP, the app reads it once and puts the guest at that table by itself.
**iPhone cannot.** Apple gives no way to carry anything through the App Store (and we do not use the clipboard trick or a paid service). After installing, the guest opens the app and scans the table QR again. The page says so.

## Where you set it
Superadmin app > Shops > the shop > Edit > **Opening the app from a table QR**
- Play Store link, App Store link (both optional, https links).
- Advanced (only for the next app build): Android certificate fingerprints (SHA-256) and the iPhone app id.

## Printing
Superadmin app > More > **QR codes**: the demo QR and the table codes (one PDF sheet for all tables, or one table as SVG, PDF or PNG). A shop logo in the middle is optional and only for tables. The demo QR never has a logo.
The shop's own Tables page (owner app) prints stickers with the same short address.

## Opening the app straight from the QR (needs a NEW app build)
Today the page tries the app's own link (`<shop>://table/7?k=...`) and then shows the choice. That works on every installed app with no new build. To make the installed app open straight from the phone camera, with no page in between, build the apps with https app links:

1. On the server set `QR_BASE_URL=https://<your QR address>` (a domain that points to the Render server).
2. For each shop, fill the advanced fields: the Android SHA-256 fingerprint(s) from Play Console > Setup > App signing, and the iPhone app id (`TEAMID.bundle.id`).
3. The server then serves `https://<QR address>/.well-known/assetlinks.json` and `/.well-known/apple-app-site-association` by itself, listing only the shops that filled the details in. Check both in a browser.
4. Build each app with `QR_LINK_HOST=<the QR address, without https://>` in the environment. `app.config.js` then adds the Android intent filter (verified) and the iPhone associated domain. Builds made without it are exactly as before.
5. A phone that has the new build opens the app on the table straight from the camera. Phones with an older build keep using the page.

## The website
The "Continue in browser" button and every computer go to `https://<shop>.<your web domain>/?table=7&k=...` (or `SHOP_WEB_URL_TEMPLATE`, like `https://{slug}.vivyaan.co.in`). The website sets the table from that address.

## Checks the code makes
- A table number that the shop does not have is refused (`/q/t/<shop>/9` when there are 5 tables).
- The app may ask the server for a table by its short address; the server signs it. The short address is public on purpose, like the printed sticker.
