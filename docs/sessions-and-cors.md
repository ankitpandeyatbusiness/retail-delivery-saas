# Where you're logged in, and which websites may call the API (web phase 3)

## What it is
Every panel (customer, owner, cook, waiter, rider) has a screen **Where you're logged in**: every phone and browser signed in as that person, with
the device name, an approximate place, the login time and the last-active time, a **Log out** for each, and **Log out all other devices**.

- Customer: Account > Where you're logged in. Owner: Shop hub > Your app. Rider and staff: Profile.
- A device that is logged out is signed out **at once**: its token stops working and its live connection is closed.
- A person only ever sees and ends their own sessions (one shop at a time; a brand owner's other branches are separate logins).

## How it works
- A session is one row per device (`models/Session.js`). New fields: `platform` (android / ios / web), `deviceLabel` ("Chrome on Windows", "Android app"),
  `city`, `region`, `country`, `place`. The IP address itself is never stored (only a hash, as before).
- The app already sent `x-app-platform` on every request; the server reads it (`services/clientInfo.js`). The device name for a browser comes from its user-agent.
- Endpoints (`routes/authRouter.js`): `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/sessions/logout-others`.
- Limits: an ordinary person up to 5 devices (unchanged). A **rider** keeps ONE phone and may also have ONE website session beside it; the limit is counted per kind, so
  opening the website never signs the rider's phone out.

## The place (city) of a login
The server never calls an outside service. It uses, in order:
1. Cloudflare headers `cf-ipcity`, `cf-region`, `cf-ipcountry` (free once the API or site is behind Cloudflare; for city and region switch on
   **Cloudflare > Rules > Settings > Managed Transforms > Add visitor location headers**).
2. The npm package `geoip-lite`, only if you install it (`cd backend && npm i geoip-lite`; works offline, about 60 MB, city level is rough in India).
3. Nothing: the list says "Location not known". A local address (testing on your own network) says "Local network".

Until one of the first two is in place, logins in production show "Location not known".

## Which websites may call the API (CORS) - `middlewares/corsPolicy.js`
Before: every website. Now: only
- `https://<shop>.<WEB_BASE_DOMAIN>` and `https://<WEB_BASE_DOMAIN>` (env `WEB_BASE_DOMAIN`, default `vivyaan.co.in`),
- origins listed in env `CORS_ORIGINS` (comma separated; a client's custom domain goes here until the custom-domain phase automates it),
- localhost and local-network addresses while `NODE_ENV` is not `production` (or `CORS_ALLOW_LOCAL=1`).

The phone apps send no Origin header and are not affected. **Before the website goes live set `WEB_BASE_DOMAIN` (or `CORS_ORIGINS`) on the server**, or browsers are refused.

## Test list (on a phone and a browser)
1. Log in as a customer on the phone and in a browser (`localhost:8081/?shop=...`). Open Account > Where you're logged in: two rows, this one marked **This device**.
2. On the phone press **Log out** on the browser row: the browser is signed out within seconds (it returns to Login).
3. Log in on both again, press **Log out all other devices** on the phone: the browser is signed out, the phone stays.
4. Rider: log in on the phone, then on the website. The phone must stay signed in. Log in on a second phone: the first phone is signed out, the website stays.
5. Owner, cook, waiter: the row is in Shop hub (Your app) and in the staff profile.
6. Rows show device name ("Chrome on Windows"), the time, and "Local network" or "Location not known" while testing.
