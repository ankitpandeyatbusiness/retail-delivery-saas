# The public demo website

One link (and one QR code) that lets a possible customer try the whole app with no login. It is the same app code as the shop websites, built for a fake shop called **demo**.

## What a visitor sees
1. A short welcome animation: the company logo and name (Vivyaan Business Systems Pvt. Ltd., or whatever you saved as the legal name in Platform business settings), then "Welcome" in English, Hindi, Marathi, Gujarati and Bengali. A **Skip** button is always there. It plays once per browser tab.
2. One big **Start the demo** button. One tap, no OTP, no login. They become a pretend customer (Aarav) of the Demo Shop.
3. A small **Demo** button at the top. It opens a list: Customer, Owner, Cook, Waiter, Rider. Tapping one becomes that person. **Reset the demo** is at the bottom of the same list.
4. Everything is pretend: orders move by themselves (accepted, cooked, picked up, the rider pin travels to the door, delivered), the owner can really accept, cook and hand over, and nothing real is ever sent or paid. The Terms, Privacy and About pages show the platform text with no shop name.

## What is on the server
- The demo shop (slug `demo`, plus two branches `demo-city` and `demo-mall`) is built by the server the first time it starts. To rebuild it by hand: `cd backend && npm run seed:demo`.
- It puts itself back to the start every night at 4 AM India time. **Reset the demo** does it at any time (once a minute at most).
- The pretend people use the numbers 6000000001 to 6000000005 (and a few more starting 600000001x, 600000003x). They are not real numbers and never get an SMS.
- Nobody can order, pay or upload anything real: online payment, money and device registration are refused in the demo shop, and a complaint photo is small (under 1.5 MB), temporary and deleted at the next reset.
- Entry is limited to 40 taps per hour per visitor address.
- Photos: free licences, listed in `docs/demo-photo-sources.md`.

## Making the website (second Vercel project)
The shop website is one Vercel project. The demo is a SECOND project of the same code, so the two never mix.

1. In Vercel, **Add New > Project**, pick the same GitHub repository. Name it for example `retail-delivery-saas-demo`. Set **Root Directory** to `mobile`. The build command and output folder are read from `mobile/vercel.json` (`npm run build:web`, `dist-web`). Keep automatic deployments off, like the first project.
2. Environment variables of that project:
   - `APP_TENANT` = `demo`
   - `WEB_API_URL` = your Render address ending in `/api` (the same as the shop website)
   - `MEDIA_CDN_URL` = the same as the shop website
   - `EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY` = the same browser map key
3. On Render, add the temporary Vercel address to `CORS_ORIGINS` (full address, for example `https://retail-delivery-saas-demo.vercel.app`) so the browser may call the server. Once you own the domain, `demo.<your domain>` is allowed by itself and needs nothing.
4. Until the domain is connected the website does not know its shop from the address, so open it once as `https://<the-demo-address>/?shop=demo` (it remembers it). `APP_TENANT=demo` makes `demo` the default anyway.
5. Deploy with `npx vercel --prod` from the repo root, choosing the demo project (run `npx vercel link` for the demo project in a separate copy of the folder, or deploy from the Vercel dashboard).
6. Keep the Render server awake (the free plan sleeps and the first tap would wait about a minute). Do not print QR banners until the real domain is connected.

## The private demo login (for friends and Razorpay)
More tab of the supreme admin app > **Demo login**: set one number and OTP. It opens ANY shop as a brand new person (no real orders, no real money). Change the OTP when Razorpay gives you the live keys.
