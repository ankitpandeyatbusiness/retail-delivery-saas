# Demo go-live: from "built" to "banners printed"

Everything for the demo is built and tested. What is left needs YOU: the domain, the hosts and a real phone. The app shows the live state of most of this: **superadmin app > More > Demo login > Go-live checks** (green = ready, "To do" = do this first). **More > Server setup** lists the same settings.

## 1. Buy the domain and point it
1. Buy the domain (for example `vivyaan.co.in`). Add it to Cloudflare.
2. Point these names (see `docs/web-pwa-plan.md` and `docs/custom-domain-plan.md` for the shop websites):
   - `demo.<domain>`  -> the demo project in Vercel (step 2).
   - `<domain>` or `go.<domain>` -> the Render server. This is the **QR address**: the printed codes hold `https://<that address>/q/...`.
3. Never print before this step is done. The QR must hold an address on your own domain, so it works for ever.

## 2. The demo website (second Vercel project)
Follow `docs/demo-public-site.md`: root `mobile`, `APP_TENANT=demo`, the same `WEB_API_URL`, `MEDIA_CDN_URL` and map key as the shop website. Add `demo.<domain>` as its domain.

## 3. Settings on Render (Environment)
| Name | Value | What it does |
|---|---|---|
| `QR_BASE_URL` | `https://<QR address>` (no slash at the end) | the address inside every printed QR |
| `DEMO_SITE_URL` | `https://demo.<domain>` | where `/q/demo` leads |
| `PLATFORM_WEB_DOMAIN` | `<domain>` | shop websites are `<shop>.<domain>`; the demo address and CORS follow it |
| `SHOP_WEB_URL_TEMPLATE` | `https://{slug}.<domain>` (optional) | the website a table QR opens |
| `SERVER_URL` | the Render address | lets the server ping itself |
| `CORS_ORIGINS` | the temporary Vercel address while testing (optional) | lets that browser address call the server |

After saving, open **More > Demo login > Go-live checks**. Every row should read Ready (the "Server stays awake" row stays "Check": see step 4).

## 4. Keep the server awake
The free Render plan sleeps after about 15 minutes and the first visitor waits about a minute. The server cannot wake itself. Choose one:
- a paid Render plan (always on), or
- a free pinger such as UptimeRobot that opens `https://<render address>/health` every 5 minutes.

## 5. Final check on a real phone and a computer
Use `docs/demo-phone-test.md`. Do it once with the English app and once with Hindi.

## 6. Print
In the superadmin app: **More > QR codes**.
- Demo banner: choose **PDF** (vector) and the printed size (5 cm to 1 m), or **SVG** for a designer. For a small flyer, PNG at 600 DPI.
- Table stickers: pick the shop, **All tables (PDF sheet)**, with the shop logo in the middle if you like.
The demo code never has a logo. The screen warns "temporary address" until step 3 is done.

## 7. Hand over to Razorpay
1. More > **Demo login**: set a number and a 6 digit OTP.
2. Give the reviewers: the shop's web address, that number and that OTP. They sign in to ANY shop and see it as a new person; they can switch to Owner, Cook, Waiter and Rider with the **Demo** button; nothing real is sent or paid; every demo login is written in the audit log.
3. When Razorpay gives you the live keys, change the OTP (or remove the demo login).

## What the server does by itself
- Builds the demo shop (menu, offers, services, tables, team, a month of orders, three branches) when it starts.
- Moves visitors' orders along (accepted, cooked, picked up, the rider pin travels, delivered).
- Resets the demo every night at 4 AM India time, and whenever a visitor taps **Reset the demo** (once a minute at most).
- Keeps the demo shop out of the monthly report emails and other real-shop jobs.
