# Putting the website online (web phase 11)

One website build and ONE Cloudflare Worker serve every shop at `<shop>.vivyaan.co.in`. The API stays on Render. Everything below runs on Cloudflare's free plan.
Files: `deploy/cloudflare/` (worker, wrangler.toml), `mobile/scripts/build-web.js`.

## How a visit works
`savera.vivyaan.co.in` -> Cloudflare Worker -> the website files (the same for every shop) -> the app reads "savera" from the address and asks the API for that shop.
The Worker also answers `/manifest.webmanifest` per shop (name, colour, icon for "Add to Home Screen") by asking the API (`GET /api/tenants/manifest`), and adds security and cache headers.

## The per-shop switches (already built, on the supreme admin's shop Plan screen)
| Website | App | What people see |
|---|---|---|
| on | on | both work; the website shows a **Get the app** bar (links to the Play Store) |
| off | on | the website says "available in the app only" with a **Get the app** button; the app works |
| on | off | the installed app says "We are on the website now" with an **Open the website** button; the website works |
| off | off | both say "temporarily unavailable" |
The Play Store link comes from the shop's Android package name (`androidPackage`), so a shop whose app is not published has no button. Owners, riders and staff are never shown these messages.

## One-time setup
1. **Buy the domain** (`vivyaan.co.in`) and add it to Cloudflare (Add a site, free plan). Change the name servers at your registrar to the two Cloudflare gives you.
2. **DNS** in Cloudflare: add a record `*` (wildcard), type **A**, value `192.0.2.1`, **Proxied (orange cloud)**. The address is a dummy: the Worker answers before it is used. Add the same for the bare domain only if you want a landing page.
3. **Build the website** (needs Node):
   ```
   cd mobile
   WEB_API_URL=https://<your-app>.onrender.com/api MEDIA_CDN_URL=<the media address from eas.json> npm run build:web
   ```
   (PowerShell: `$env:WEB_API_URL='...'; $env:MEDIA_CDN_URL='...'; npm run build:web`). It stops with a clear message if the API address is missing or is localhost.
4. **Edit `deploy/cloudflare/wrangler.toml`**: put your real Render address in `API_BASE` (with `/api`). Check `PLATFORM_WEB_DOMAIN`.
5. **Deploy**: `cd deploy/cloudflare && npx wrangler login && npx wrangler deploy`. The route `*.vivyaan.co.in/*` is created for you.
6. **Render environment** (Dashboard > your service > Environment), then redeploy:
   - `PLATFORM_WEB_DOMAIN=vivyaan.co.in` (CORS and the switches read it; `WEB_BASE_DOMAIN` still works)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (browser notifications: `docs/web-push.md`)
   - `NODE_ENV=production` (then `localhost` is no longer allowed by CORS)
7. **Other services must allow the website address**:
   - Google Cloud: the browser maps key > HTTP referrers `https://*.vivyaan.co.in/*` (`docs/web-maps.md`).
   - Cloudflare R2 bucket > CORS: origin `https://*.vivyaan.co.in`, methods PUT, GET, HEAD (`docs/web-files.md`).
   - Each shop's own Razorpay dashboard: approve the shop's website address (`docs/web-payments.md`).
8. Open `https://<a shop slug>.vivyaan.co.in` on a phone and a computer.

## Updating the website later
Build again (step 3) and `npx wrangler deploy`. Visitors get the new version on their next visit (the page and the service worker are never cached; the numbered files are cached for a year).
Changing only the API (Render) needs no website deploy.

## Not done yet (later)
A shop's own domain (Pro): `docs/custom-domain-plan.md` (Cloudflare for SaaS).
