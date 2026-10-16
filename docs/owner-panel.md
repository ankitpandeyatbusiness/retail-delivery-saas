# Owner panel (shop admin) inside the customer app

One app, three panels, chosen by the phone number's role: a customer gets the shop tabs, a `rider` gets the delivery
screen, an `admin` (the shop owner) gets the owner panel. Code lives next to the customer code, in `owners/` folders:
`mobile/src/{screens,components,api,store,utils,hooks}/owners/`.

The shop's own logo, colours, font and light/dark look are used everywhere (`useBrand()`), so the owner feels he is in his
own app. Every owner screen talks to `/api/shop/*` (the same routers the superadmin reaches through
`/api/admin/tenants/:tid/shop/*`). API wrappers: `mobile/src/api/owners/shopApi.js` (one function per endpoint).

Related: `docs/owner-soundbox.md` (the new-order alert, built first).

## Plan and status

| Phase | Scope | Status |
|---|---|---|
| 0 | Role routing, owner tabs, UI kit, API layer, Soundbox | done |
| **1** | **Home dashboard, Orders board, order detail, pause orders** | **done (written; needs a device run)** |
| **2** | **Menu: categories, items, stock, photos, sold-out timer, collections** | **done (written; needs a device run)** |
| **3** | **Riders, live map, cash on delivery, performance, rider rules** | **done (written; needs a device run)** |
| **4** | **Money: sales, Excel export, payments, refunds, SMS wallet, rent** | **done (written; needs a device run)** |
| **5** | **Hub: customers, complaints, reviews, messages, coupons, banners** | **done (written; needs a device run)** |
| **6** | **Settings: hours, holidays, delivery area and fee editor, shop details, inbox, activity log, busy mode, closing report** | **done (written; needs a device run)** |
| 7 | Growth: insights, win-back, scheduled orders, KOT, staff accounts | |

Tabs: **Home · Orders · Menu · Riders · Money**. Everything else is in the **Shop hub** (the hamburger at the top left).
Access levels enforced by the server (and shown as a banner): normal / rent unpaid (menu and settings locked, orders, riders,
money open) / panel blocked by the platform (only orders in progress, rent, notifications).

## Phase 1 in detail

### Home (`OwnerHomeScreen.jsx`)
One call, `GET /api/shop/dashboard`, fills it; it refreshes when an order changes (socket `order:update`) and on focus.
Top to bottom: a **Silence** button while a real order rings; "Orders are paused" with **Start**; "N new orders waiting"
with the countdown to the automatic cancel; **Today** (sales, delivered, average order, change vs yesterday up to the same
time, sales by hour, placed / cancelled and the money lost, average time to accept); the order pipeline (tap a stage to
open that chip on the board); riders; **Needs your attention** (out of stock, running low, complaints, SMS balance, rent
due, cash with riders); Soundbox status; the latest feed lines.

### Orders board (`OwnerOrdersScreen.jsx`, `useOrdersStore.js`)
Chips (Active, New, Accepted, Preparing, Ready, On the road, Delivered, Cancelled) with live counts, search by order
number, infinite scroll, pull to refresh. Each **order card has Accept / Reject right on it**; later stages show the next
step. Unaccepted orders sort first, oldest first (they expire).

### Order detail (`OwnerOrderScreen.jsx`)
Items with options and notes, the customer's instructions, the bill, customer (Call, WhatsApp), address (Open in Maps),
the delivery rider (status in words, rider problems, assign / change / remove, call, where is he), the timeline, the
invoice PDF (after delivery), "Mark as not delivered" (the server allows it 15 minutes after the rider's first problem; the
screen counts down), and an action bar that is always in reach. Opening an order stops its new-order alert.

### Rules the app follows (do not duplicate them, ask the server)
- Which step comes next, and whether cancel / "not delivered" is allowed: `order.allowedNext` (backend `services/orderflow.js`).
  Delivery orders: placed, accepted, preparing, out for delivery, delivered. Pickup and dine-in: placed, accepted, preparing,
  ready, delivered. The app only names the steps (`utils/owners/orderFlow.js`).
- **Reject needs a reason**: busy, out of stock, shop problem, customer asked, or **Other with the owner's own typed words**
  (at least 3 letters). Any reason can also carry a note. "Not delivered" asks who was at fault: customer, shop, rider.
- An order nobody accepts is cancelled by the server after `ORDER_ACCEPT_TIMEOUT_MIN` (default 10) minutes, with reminders at
  3 and 6. Every waiting order carries `acceptBy` (the moment it will be cancelled); the app shows a countdown.

### Pause orders (timed pause)
The status line under the shop name opens a sheet: 30 minutes, 1 hour, 2 hours, until tomorrow morning (4 AM India time),
until I start again, or **Start taking orders now**. `PUT /api/shop/accepting-orders`:
`{acceptingOrders:true}` · `{acceptingOrders:false}` · `{acceptingOrders:false, pauseMinutes:30}` ·
`{acceptingOrders:false, untilMorning:true}`. A timed pause stores `settings.orders.pausedUntil` and leaves the on/off switch
ON; `resolveConfig()` (backend `tenantConfigService.js`) treats the shop as paused until that time and as open after it,
so **nothing has to run at the moment it ends** and a forgotten pause cannot lose a day of sales. A save from the superadmin
panel keeps it (`utils/keepOwnerPause.js`); the superadmin sees it as "Owner paused" with the end time (`utils/shopState.js`).

## Backend added in Phase 1
| What | Where |
|---|---|
| `GET /api/shop/dashboard` (open while rent is unpaid, like `/live`) | `routes/shopRouter.js`, `services/dashboardService.js` |
| Timed pause | `routes/shopRouter.js`, `services/tenantConfigService.js`, `utils/keepOwnerPause.js`, `utils/shopState.js` |
| `acceptBy` on every waiting order | `services/orderTimeout.js` (`acceptDeadline`), `routes/shopRouter.js` (`view`) |

"Sales" always means **delivered** orders counted on the day they were delivered (same rule as the sales report):
food + packaging - discount. Delivery fee, tax and tips are not the shop's sales.

## Files (mobile)
| File | Role |
|---|---|
| `screens/owners/OwnerHomeScreen.jsx`, `OwnerOrdersScreen.jsx`, `OwnerOrderScreen.jsx` | the three Phase 1 screens |
| `components/owners/ui.jsx` | cards, buttons, chips, option rows, **Sheet**, text field, header with the **pause sheet** |
| `components/owners/orderBits.jsx` | order card, status pill, countdown, `useOrderActions` (accept / reject / not delivered), reason sheet, rider sheet, call / WhatsApp / maps / invoice |
| `store/owners/useOwnerStore.js` | live picture, dashboard, billing, access state |
| `store/owners/useOrdersStore.js` | the board's list, counts, paging, patching an order in place |
| `utils/owners/orderFlow.js` | labels, reasons, filters, time and money wording (pure functions) |
| `hooks/owners/useNow.js` | a ticking clock for countdowns |

## Testing
Backend: `node --test --test-concurrency=1 --test-force-exit tests/ownerHome.test.js` (timed pause, dashboard, `acceptBy`).
Run the whole suite with `npm test` in `backend/`.
App: run a development build (`npx expo run:android`), log in with an owner number; place orders from a customer phone
(or the seed shop) to see them arrive. Pure helpers can be checked with Node (they have no React in them).

## Phase 2 in detail (Menu)
- **Menu tab** (`OwnerMenuScreen`): search, chips (All, Sold out, one per category), items grouped by category. Each row has an **In stock** switch: off asks *For today / 1 hour / 2 hours / Until I switch it on*; a counted item shows "N left" with − and +. Tap = edit, **Add item** button, links to Categories and Collections (also in the Shop hub).
- **Item form** (`OwnerItemScreen`): kind + sold-by (piece/weight/volume, amounts editor), category (pick, or type a new one: the server reuses/creates it), name, description, picture (uploaded at once), price/MRP, veg/non-veg and flags, spice, serves/calories/prep time, bestseller/new/gift, choice groups (sizes, add-ons), daily stock, visible, remove (soft delete). Rules mirror the server in `utils/owners/menuRules.js`.
- **Categories** list (up/down reorder, visible switch) and form (name, picture or one of its dishes' pictures, opening-hours slots). **Collections** list (reorder, switch) and form (kind, title, items picker, dates).
- Files: `screens/owners/Owner{Menu,Item,Categories,Category,Collections,Collection}Screen.jsx`, `components/owners/menuBits.jsx`, `store/owners/useMenuStore.js`, `utils/owners/{menuRules,upload}.js`. Stack routes: OwnerItem, OwnerCategories, OwnerCategory, OwnerCollections, OwnerCollection.
- **Backend added**: `Product.unavailableUntil` + `stockService.sweepSoldOut` (items come back by themselves; runs when the menu is read, at most every 20 s per shop; a counted item with no stock stays off); `PATCH /api/shop/products/:id/availability` `{available, minutes? | untilMorning?}` (409 when turning on a counted item with 0 left); `GET /api/shop/menu` (all categories incl. hidden with item counts + light items, up to 600); `GET /api/shop/menu/options` (item kinds, quick sizes, food mode); `PUT /api/shop/{categories,products,collections}/order` `{ids}`; `utils/nextMorning.js` (4 AM India, shared with the timed pause). Setting stock clears an older "sold out until". Tests: `backend/tests/ownerMenu.test.js` (full suite 611 pass).
- Not built (by design): drag handles (arrows instead), bulk import (superadmin has it), banners/coupons (Phase 5).

## Phase 3 in detail (Riders)
- **Riders tab** (`OwnerRidersScreen`): online count and total cash with riders, quick buttons (Live map, Performance, Rules), "Cash to collect" list, every rider as a card (online/offline, orders on delivery, rating, **Can deliver** switch), **Add a rider** by mobile number.
- **Rider page** (`OwnerRiderScreen`, param `userId`): call/WhatsApp, orders he is delivering (tap opens the order), the cash he owes with **Cash received** (handover, cannot exceed what he owes) and **Correction** (reason required), cash history with paging, switch off, remove.
- **Live map** (`OwnerRiderMapScreen`): riders seen in the last 5 minutes, refreshed every 10 s, list below the map.
- **Performance** (`OwnerPerformanceScreen`): last 7 / 30 days / this month: deliveries, average minutes, rating, cash collected per rider.
- **Delivery rules** (`OwnerRiderRulesScreen`): automatic or manual assignment, answer time, orders at once, pay per delivery, delivery PIN, live tracking + interval, and the cash-on-delivery limit for new customers (`orders.codCap`). Saved with `PUT /shop/settings`; closed while rent is unpaid.
- Files: `screens/owners/Owner{Riders,Rider,RiderMap,Performance,RiderRules}Screen.jsx`, `store/owners/useRidersStore.js`, `utils/owners/riderRules.js` (rupees/paise, ledger lines, date ranges). Stack routes: OwnerRider, OwnerRiderMap, OwnerPerformance, OwnerRiderRules. Logout now clears the owner, menu and riders stores.
- **Backend added**: only `GET /api/shop/settings` (riders rules with defaults + `orders.codCap`; the Phase 6 settings screens will use it too). Everything else already existed. Tests: `backend/tests/ownerRiders.test.js`.
- Money is in paise on the wire; the screens show rupees (`rupees()`), and typed rupees become whole paise (`toPaise()`).

## Phase 4 in detail (Money)
- **Money tab** (`OwnerMoneyScreen`): bill-due banner; period chips (Today / 7 days / 30 days / This month); sales (delivered orders): total, orders, average order, not-delivered count, bars per day, payment split, best sellers, delivery fees / tax / tips / discounts; **Download Excel**; cards for Online money, SMS balance and Monthly bill.
- **Online money** (`OwnerPaymentsScreen`): received / refunded / kept for a period; tabs Money (every movement, filter All / Received / Refunds / Chargebacks / SMS / Bills), Refunds (status Asked / On the way / Done / Failed), Chargebacks (status, answer-by date).
- **SMS balance** (`OwnerSmsScreen`): balance and about how many messages, top-up packs or a typed amount, pay by UPI QR, history (All / Top-ups / Used).
- **Monthly bill** (`OwnerRentScreen`): what is due, grace days, free period, this month's orders and rate, next bill, all bills with **Pay by UPI** and **Open bill (PDF)**. Open even while the shop is paused for rent.
- `PayQrSheet` (components/owners/moneyBits.jsx) shows the QR, "Pay with a UPI app" (opens the `upi://` link), and checks every 5 s whether the money arrived (top-up status `paid` / invoice status `paid`).
- Files open through `utils/owners/files.js` (`downloadAndOpen`: PDF in the viewer, Excel through the share sheet). Helpers: `utils/owners/moneyRules.js`. Units: sales report in RUPEES; wallet, payments, refunds, top-ups in PAISE; rent invoices in rupees.
- **Backend added**: `GET /api/shop/reports/export?from&to` (Excel: Orders, Sales by day, Items sold; newest 5000 orders; formula-safe cells; unpaid online orders left out) in `services/salesExport.js`. Everything else already existed. Tests: `backend/tests/ownerMoney.test.js`.
- Stack routes: OwnerPayments, OwnerSms, OwnerRent.

## Phase 5 in detail (Shop hub: customers, care, offers)
All of these are opened from the **Shop hub** (tap the shop logo).
- **Customers** (`OwnerCustomersScreen`, `OwnerCustomerScreen`): search by name or phone; a customer's page has call/WhatsApp, orders / delivered / cancelled / spent / last order, cash-on-delivery status with **Allow cash again**, and editable name, email and private notes (phone is platform-only).
- **Complaints** (`OwnerComplaintsScreen`, `OwnerComplaintScreen`): New / In progress / Decided; the page shows the text and photos, links to the order, and the answer: *Reply only*, *Full refund*, *Part refund* (amount, capped to the order without the tip), *No refund* (reply required). Online orders are refunded automatically; for cash orders the refund is only noted (the screen says so).
- **Reviews** (`OwnerReviewsScreen`): Food / Delivery, average, count per star, star filter, comments, tap opens the order.
- **Messages** (`OwnerMessagesScreen`): compose (customers / riders / both, information or offer, optional email), confirm before sending, list of sent messages with delivered / failed counts (refreshes every 8 s). 5 a day, never SMS.
- **Coupons** (`OwnerCouponsScreen`, `OwnerCouponScreen`) and **Banners** (`OwnerBannersScreen`, `OwnerBannerScreen`): list with on/off switch (banners can be ordered with arrows), form with all fields, dates as YYYY-MM-DD, banner can show one of the active coupon codes.
- Collections (Phase 2) stay under Menu / Shop hub → Menu.
- Helpers: `utils/owners/hubRules.js` (labels, coupon text and checks). Stack routes: OwnerCustomers, OwnerCustomer, OwnerComplaints, OwnerComplaint, OwnerReviews, OwnerMessages, OwnerCoupons, OwnerCoupon, OwnerBanners, OwnerBanner.
- **Backend added**: `GET /api/shop/reviews?kind=dish|delivery&rating=1..5&page=` with a summary (`services/reviewsService.js`; Tier-1 #7) and `PUT /api/shop/banners/order {ids}`. Tests: `backend/tests/ownerHub.test.js`.

## Phase 6 in detail (Settings, polish)
Opened from the **Shop hub**.
- **Opening hours** (`OwnerHoursScreen`): switch "Use opening hours" (off = no hours, orders whenever they are on); each day open/closed with up to 3 time slots (`HH:MM`, a closing time before the opening time means past midnight); closed message; **holidays** (first and last closed day, optional message, up to 30). Saved with `PUT /shop/settings { hours }` (the whole hours object, every day present).
- **Delivery area and fees** (`OwnerDeliveryScreen`): pin on a map (`components/owners/pinMap.jsx`, drag the map or "Use my position", circle shows the distance), delivery distance, smallest order, **delivery fee editor** (Free / Same for all / By distance, free-above, highest fee), packaging charge, usual preparation time, tip buttons (up to 5), GST shown read-only. Saved with `PUT /shop/settings { orders:{deliveryFee, packagingCharge, minOrder, tipOptions, prepTimeMin}, delivery:{latitude, longitude, radiusKm} }`.
- **Shop settings** (`OwnerShopSettingsScreen`): shop phone, address, SMS alerts on/off.
- **Messages for you** (`OwnerNotificationsScreen`, the bell on every tab and a hub row): the owner inbox `GET /shop/notifications`, tap = read, "Mark all read"; the bell badge now counts THIS inbox (`useOwnerStore.unread`), not the customer inbox.
- **Activity log** (`OwnerActivityScreen`): who changed what, filter Everyone / You / Riders / Platform / Automatic; technical actions are turned into plain words by `activityLabel()` in `utils/owners/settingsRules.js`.
- **Busy mode** (sheet in the hub, backend #5): "+15/30/45/60 min for 1 h / 2 h / until tomorrow morning" or off. Customers see a longer preparation time; it ends by itself (resolved in `resolveConfig`, nothing runs at the end). `keepOwnerPause` also keeps it when the superadmin panel saves the whole form.
- **Closing report** (`OwnerClosingScreen`, backend #6): Today / Yesterday / two days ago: sales, payment split, orders placed / delivered / cancelled (by whom) / not delivered, cash collected by riders and still with riders, online received / refunded, best sellers, complaints; **Share** sends it as text.
- **Backend added**: `GET /api/shop/settings` now returns everything the owner can change (phone, address, delivery, hours, riders, notifications, orders incl. fees, busy, GST read-only); `PUT /api/shop/settings` accepts `orders.{codCap, deliveryFee, packagingCharge, tipOptions, minOrder, prepTimeMin}` (Tier-1 #1; GST, payment methods and order types stay with the platform); `PUT /api/shop/busy`; `GET /api/shop/closing-report?date=`. Tests: `backend/tests/ownerSettings.test.js`.
- Stack routes: OwnerHours, OwnerDelivery, OwnerShopSettings, OwnerNotifications, OwnerActivity, OwnerClosing.

## Round 2 changes (after the first look at the app)
- **Tab bar**: the owner tabs now use the customer app's floating bar, rounded sliding highlight and page motion (`navigation/tabKit.jsx`, shared by both). Tab switches wait for a page that is still sliding (the "gate").
- **Side menu**: a hamburger at the top left of every tab opens `components/owners/OwnerDrawer.jsx` (the whole Shop menu: `ShopMenu` in `screens/owners/ShopHubScreen.jsx`). The logo/name in the header are no longer buttons. No dark layer over the page; tap beside it or press Back to close.
- **Logo**: the header and the menu show the shop's real logo (`restaurant.logo` from the shop config; the theme never had one), with the first letter as fallback.
- **Bottom sheets**: no dark/shadow layer any more over the page (the sheet has a thin border and a soft top shadow instead).
- **Inbox**: opening "Messages for you" marks everything read (new ones keep their dot until you leave); **Clear all** hides all messages (`DELETE /api/shop/notifications`, soft: `Notification.clearedAt`, marked read first so no SMS escalation).
- **Customer view**: menu → "See the customer app" (`store/owners/useViewMode.js`, `Landing` in AppNavigator). A "Back to owner panel" button stays on screen (`OwnerViewPill`). The owner cannot order: the cart refuses, and the server refuses too (`orderService.placeOrder`: only role `customer` may order, 403 otherwise).
- **Paying rent / SMS top-up**: "Pay now" opens **Payment options** (`OwnerPayScreen`): PhonePe / Google Pay / Paytm / Navi, Other UPI app, Credit/Debit card, or Scan a QR. Same Razorpay checkout as the customer app (`utils/owners/payPlatform.js`). Server side `services/platformCheckout.js`: `POST /shop/subscription/invoices/:id/pay/start|verify`, `POST /shop/sms/topup/start`, `POST /shop/sms/topup/:id/verify`; the platform webhook `payment.captured` is the safety net. Fields: `SubscriptionInvoice.payOrder`, `SmsTopup.rzpOrderId`.
- **Transactions and bills** (menu → Transactions and bills, and a card on the Money tab): year chips, 12 months with money in / out / kept (`GET /shop/payments/summary?year=`), tap a month for its entries with filters; a monthly bill opens its PDF, an order entry opens the order; **Download** gives a spreadsheet (CSV) of the month or the year (`GET /shop/payments/transactions?format=csv`).
- Tests: `backend/tests/ownerPlatformPay.test.js`.

## Round 3 changes
- **Shimmer, not spinners**: every loading state in the owner panel is a shimmer of the shape of what is coming (`components/owners/shimmer.jsx`: `ListShimmer`, `FormShimmer`, `StatShimmer`, `LineShimmer`, built on the customer app's `Skel`). Only the small spinner inside a button (while it saves) remains.
- **Side menu** sits inside the safe area: its top starts below the status bar and its bottom above the navigation bar (rounded right corners), so it no longer covers the status bar.
- **Customer view** is a real stack page (`CustomerPreview` in AppNavigator): it slides in from the right like any page and slides out when you go back (the on-screen button, swipe or Android Back from its Home tab).
- **Logo**: a shop without its own logo shows the app icon from its media storage (`tenants/<slug>/branding/icon.png`, set as `restaurant.logo` in `resolveConfig`).
- **Appearance** (System / Light / Dark) is in the side menu, under "Your app".

## Not done yet (known)
- Phases 1 to 6 have not been run on a device at the time of writing: expect small layout fixes on first run.

## Round 4 changes
- **Tabs**: all five owner tabs are mounted at start (`lazy: false`), so a tab no longer shows an empty page while it slides in for the first time; the Money tab shows a shimmer instead of a blank block while it loads.
- **Popular items** (menu → Popular items, and "See all" on Money): best sellers for the last 7 days, 30 days or 3 months, up to 30 items (`GET /shop/reports/sales?topLimit=`, default 10, max 50).
- **Billing pop-up** (`components/owners/BillingPrompt.jsx`): an unpaid bill (grace days, or the shop paused) and a low/finished SMS balance open a "Pay now / Remind me later" sheet a moment after the panel opens and whenever the app returns to the front (server rules in `billingPromptService`: postponed warnings return after 6 hours; a paused shop or a finished balance that blocks login cannot be postponed).
- **Free period** card on Home shows a clear "ending soon" line when 7 days or 10% of the free orders (or fewer than 5) are left. The server also sends the owner a push and an inbox message when the free period is ending (`free_ending`, `bill_reminder`).
- Not tracked: what customers **search** for. Searches are not recorded anywhere yet.

## Round 5 changes
- **Live switch** (top bar, `LiveToggle` in `components/owners/ui.jsx`): replaces "tap to change". ON ("LIVE", green) = the shop takes orders. Turning it OFF opens the same questions as before (30 minutes, 1 hour, 2 hours, until tomorrow morning, until I start again); turning it ON starts at once. It uses the existing `PUT /shop/accepting-orders`. (This is the owner's open/closed switch, not the platform's billing "go live".)
- **My profile** (side menu → Your app → My profile, `OwnerProfileScreen`): profile picture (camera or gallery, via `/api/me/uploads`, kind `customer`), name (2 to 80 letters) and email (optional). The registered mobile number is shown greyed out with a lock and cannot be edited. Backend: `GET/PUT /api/shop/profile` (`routes/shopProfileRouter.js`, open even while the shop is paused; refuses a phone change and any field but name and email; the OLD email address is told when the email changes). Tests: `backend/tests/ownerProfile.test.js`.

## Round 6 changes
- **Monthly fee plan** is shown on Money → Monthly bill (`plan` in `GET /shop/billing/status`: the order tiers with the shop's current tier highlighted, or a fixed fee if the platform set one for the shop; a shop's own tiers win over the platform's).
- **Plan change notices** (`services/feePlanNotice.js`): when the platform changes the tiers, every active shop that uses them gets an inbox message and a push ("Your monthly fee plan changed" with the new table); a shop with its own plan is not told about the platform plan. When one shop's own plan (tiers or fixed fee) is set or removed, that shop is told. Saving the same plan again tells nobody. Bills already issued never change. Tests: `backend/tests/ownerPlan.test.js`.

## Help and support (owner app + superadmin app)
A conversation between the shop owner and the platform team.
- **Owner app** (side menu → Help and support): the contact card (Call / WhatsApp / Email buttons, support hours and the reply promise, all set by the superadmin); "Ask for help" (topic, title, message, up to 3 pictures; shop, phone and app version are added automatically); the list of requests (Open / Solved, a dot for a new reply); the conversation (reply with pictures, **Mark solved**, a 1 to 5 star rating once solved, reopen by replying within 7 days). It works while the shop is paused for rent or the panel is blocked. A reply from the team arrives as an inbox message and a push; tapping it opens the request.
  Files: `screens/owners/OwnerSupport{,New,Ticket}Screen.jsx`, `components/owners/PictureStrip.jsx`, `utils/owners/supportRules.js`; routes OwnerSupport, OwnerSupportNew, OwnerSupportTicket.
- **Superadmin app** (More → Support requests, and a line on Home): the inbox (Needs reply / Waiting for shop / Solved / All, search by shop, title or #number, newest unread first), the request page (shop and owner card with Call, the conversation, status and priority, saved replies, pictures, **private notes** the owner never sees, Send and solve), and "Contact details" (the contact card owners see). A new request or a new owner reply sends the superadmin an alert and a push (tapping the alert in the Alerts inbox opens the request).
  Files: `superadmin/src/screens/support/*`, `api/supportApi.js`; routes Support, SupportDetail, SupportSettings.
- **Backend**: model `SupportTicket` (numbers start at 1001), `services/supportService.js`; owner routes `/api/shop/support` (info, list, create, read, reply, resolve, rate, and its own `/uploads/sign|confirm` for pictures, open even when the shop is paused); admin routes `/api/admin/support` (list, counts, settings, read, reply, note, status and priority). Limits: 5 new requests per shop per day, 10 open at once, 3 pictures and 2000 characters per message. `PlatformSettings.support` holds the contact card. Alert events `admin_support_new` and `admin_support_reply`. Tests: `backend/tests/support.test.js`.
- **Tapping the push** (both apps): the owner's push for a team reply carries `kind: support` and the request id, and the owner app opens that request (also when the app was closed: it opens as soon as the navigator is ready; `utils/common/push.js`). The superadmin's push now carries `ticketId` and the superadmin app opens the request (`utils/push.js`, `navigation/ref.js`). Tests in `support.test.js`.

## Email, the business report and the monthly report (round 7)
- **Email is for the platform's official documents only.** The owner app has no "send by email" option any more (a shop's messages to customers go by push and the in-app inbox; the server ignores `sendEmail` from an owner). The superadmin's "Messages to owners" keeps its email option.
- **The owner's email is required and confirmed with a code.** If it is missing, a sheet (`components/owners/EmailPrompt.jsx`) asks for it a moment after the panel opens and cannot be closed until it is confirmed. Adding or changing it (Profile → Email) mails a 6-digit code (`services/emailVerifyService.js`, `POST /api/shop/profile/email/send-code` and `/verify`): 10 minutes, 5 tries, one code per 30 seconds, 5 a day; the address is saved only when the code is right; the OLD address is told on a change. `PUT /shop/profile` no longer accepts `email`. In a test setup (`EMAIL_MOCK=true`) the response carries `devCode`; a real setup never does.
- **Monthly bill by email: already automatic.** When the monthly invoice is generated the owner gets the in-app message, the push and the professional "Your bill ... is ready" email with the invoice PDF attached (`bill_issued` → `rent_invoice`), then a reminder before the grace date, a "payment received" receipt, and the paused / open-again mails. They go to the owner's email, which is why it is now required.
- **Business report** (`GET /api/shop/business-report?range=7|30|90|2026-09`, `services/businessReport.js`, tips in `services/businessTips.js`): sales and orders against the period before, the chart (by day, week or month), busiest hours and days, new vs returning customers and repeat %, best customers, best sellers, best rated, items that need a look, items that did not sell, best delivery partner, cancellations and what they cost, refunds, cash with riders, milestones, what the app brought in (sales, the estimated marketplace commission avoided at the platform's % (default 25), what the shop was billed, sales per ₹1 paid, totals since joining), up to 5 tips (never more than 2 worries) with a button to the right screen, and a positive line. Owner app: `OwnerBusinessScreen` (Home card, Money tab, menu → Money → Business report; tapping the monthly report notification opens that month). Superadmin app: Shop → **Progress report** (same numbers) and More → **Owner report settings** (monthly email on/off, show the marketplace comparison, the commission %, **Reset to recommended**).
- **Monthly report** (`jobs/monthlyReports.js`, hourly, from 9 AM on the 1st to the 5th; one per shop and month, claimed in `MonthlyReportLog`): every shop with orders last month gets an in-app message + push ("Your September report is ready") and an email with a one-page PDF (`services/businessReportPdf.js`). The owner can switch it off in Shop settings → Alerts and reports; the superadmin can switch it off for all.
- **Reset to recommended** buttons: Shop settings (alerts and reports), Delivery rules, and the superadmin's report settings. (Recommended values are shown beside the setting.)
- Tests: `backend/tests/businessReport.test.js`, `ownerProfile.test.js`.

## Customer profiles, Remind and Autopilot (round 8)
See [owner-autopilot.md](owner-autopilot.md): customer tags, one-tap Remind, the 56-message library (English / Hinglish / Hindi), Autopilot with its safety limits, the owner summaries, and the superadmin Shops growth screen.
