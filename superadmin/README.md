# Retail Control

Superadmin (platform owner) mobile app. Separate from the shop apps in `../mobile`.
Phone number + OTP login, talks only to `/api/admin/*`.

    cp .env.example .env     # set EXPO_PUBLIC_BASE_URL
    npm install
    npx expo run:android

Folders: `src/api` (one file per backend area), `src/store` (zustand), `src/screens/<section>`,
`src/components` (shared UI), `src/theme` (colours, spacing).

## Is every backend feature in the app? (coverage check)

    npm run coverage

Loads the backend app (fake settings, no database) and lists every route under `/api/admin`, then compares it with
every request in `src/api/*.js`:

- **COVERED**: a screen can call it
- **ALLOWED**: deliberately not in the app. Each one has a reason in `scripts/coverage.allow.js`
  (a duplicate of a route the app already uses, or an owner-only action)
- **MISSING**: nothing calls it and nobody allowed it. Exit code 1.
- **UNKNOWN CALLS**: the app calls a route the backend does not have (a typo, or a removed route)
- **UNUSED API FUNCTIONS**: written but no screen uses it

Run it after adding a backend route or an API function. A new route must either get a screen or an entry in
`coverage.allow.js` with a reason.

## Other commands

    npm run logo        redraw the app icon, adaptive icon and splash from src/theme/palette.js
    npm run coverage    the check above

## Push alerts

Push needs Firebase. Put `google-services.json` (for `com.ankitpandey.retailcontrol`) next to `app.config.js` and rebuild.
Without it the app works fully; My account says push alerts cannot start.
