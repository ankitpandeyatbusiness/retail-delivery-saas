# Customer profiles, Remind and Autopilot

Everything here reaches customers by **push notification and the in-app inbox only**. Never SMS, never email (email is kept for the platform's official documents).

## 1. Customer profiles (`backend/src/services/customerInsights.js`)
Worked out from each customer's delivered orders of the last 180 days, when asked (nothing is stored).

| Tag | Meaning |
|---|---|
| new | first order in the last 14 days |
| regular | 2 or more orders, still coming |
| loyal | 5 or more orders, still coming |
| vip | 10 or more orders (also kept as a flag, so a slipping VIP shows both) |
| slipping | quiet for longer than 2.5 x his usual gap (at least 21 days) |
| lost | quiet for 60+ days, or 4 x his usual gap |

Each profile also has: usual hour (India time), usual weekday (only when 40% or more of his orders fall on it), top 3 favourite foods, favourite food for breakfast / lunch / snacks / dinner, days since the last order, how often he orders, spend, whether he can be reached (blocked, or offers turned off), and when he was last reminded.

- `GET /api/shop/customers/insights?tag=&q=&page=` : the list with `counts` for every tag.
- `GET /api/shop/customers/:id/insight` : one customer.
- Owner app: Menu, Customers. Chips Everyone / Slipping / Lost / New / Regular / Loyal / VIP with counts; a row shows the tag, "last order N days ago", "orders around 8 PM, likes Paneer Roll"; slipping and lost rows have a **Remind** button. The customer page has a "How he orders" card and **Remind him**.

## 2. One-tap Remind
- `GET /api/shop/customers/:id/remind?offer=true` : the message he will get and whether it can go now (`canSend`, `holdBack` says why not).
- `POST /api/shop/customers/:id/remind` `{ title?, body?, withOffer? }` : sends it. The owner may edit the words (title up to 60, message up to 200 letters). With an offer a one-use coupon `BACKxxxx` (the owner's chosen %, valid 5 days, not public) is made and its code goes in the message.
- Limits for a manual reminder: the same safety rules as Autopilot, and one reminder per customer per 3 days.
- App: `components/owners/RemindSheet.jsx`.

## 3. The message library (`backend/src/services/nudgeMessages.js`)
56 messages, each in English, Hinglish and Hindi (Devanagari): win-back nudge (7), win-back offer (6), win-back last call (6), welcome (5), thank you (6), breakfast / lunch / snacks / dinner (3 / 4 / 3 / 4), festival (4), Remind button (8).
Words filled in: `{name}` (first name, "dost" / "there" if unknown), `{food}` (his favourite; "aapka favourite" when unknown), `{shop}`, `{discount}`, `{code}`, `{festival}`.
A message is not repeated to the same customer within 30 days until all of that group were used. The owner can write his own wording for any group (Autopilot, "See and edit the messages"), and go back to the ready-made ones.

## 4. Autopilot (`backend/src/services/autopilot.js`, `jobs/autopilot.js`, every 15 minutes)
Settings in the `Autopilot` collection (one per shop). **Nothing runs until the owner turns it on.** "Turn on recommended" switches on: win-back, welcome, thank you, daily summary, Monday digest. Meal-time and festival messages are off by default because they are the ones customers find most pushy.

| Automation | What it does |
|---|---|
| Win-back | for slipping / lost customers (up to 120 days quiet): step 1 a nudge, step 2 a small offer with a one-use coupon (no offer if the owner chose "No offer"), step 3 the last call, then 30 days of rest. Sent at the hour before his usual ordering hour (never inside quiet hours). An order ends the sequence. |
| Welcome | after a first delivery (20 minutes to 24 hours later) |
| Thank you | after a later delivery, at most once in 3 days to one person |
| Meal-time | the hour before a regular customer's usual hour, with the food he orders at that part of the day |
| Festival | New Year, Republic Day, Independence Day, Christmas, Dussehra (2026-10-20) and Diwali (2026-11-08), at 11 AM, to people who ordered in the last 90 days. The movable dates are in `FESTIVALS` in `autopilot.js` and must be checked and extended each year. |
| Daily summary (to the owner) | at the hour the owner chose (default 10 PM), only on days with orders |
| Monday digest (to the owner) | Monday 9 AM, last week's numbers, opens the business report |

Owner chooses: language (English / Hinglish / Hindi, recommended Hinglish), how often (Gentle / Normal / Pushy), win-back offer (No offer, 5, 10, 15, 20 %, recommended 10), quiet hours (9 PM to 9 AM recommended), summary time.

| | Gentle (recommended) | Normal | Pushy |
|---|---|---|---|
| Win-back steps | day 0, +7, +14 | day 0, +3, +7 | day 0, +2, +4 |
| Promo messages per customer per week | 2 | 3 | 4 |
| Days between two promos | 3 | 2 | 1 |

**The seatbelt (cannot be switched off):** never to a blocked customer or one who turned off offers; never within 24 hours of an order; not in quiet hours; the weekly limit; a win-back is three messages at most; each message is claimed in `NudgeLog` first, so two servers never send it twice (welcome and thank you are unique per order). The superadmin can stop one shop (`platformPaused`) or every shop (`PlatformSettings.insights.autopilotEnabled`).

**What it brought back:** a customer who orders within 3 days after a message counts for the latest message before his order (`GET /api/shop/autopilot/stats?days=30`, shown on the Autopilot screen as messages sent, customers who came back, sales from them).

Routes: `GET/PUT /api/shop/autopilot` (`{ recommended: true }` resets everything), `GET /api/shop/autopilot/library`, `GET /api/shop/autopilot/stats`.
App: Menu, Autopilot (also on the Customers page). Every change is saved at once; "Reset to recommended" brings back all recommended values.

## 5. Superadmin
- More, **Shops growth**: sales against the same number of days before for every shop (7 / 30 / 90 days), platform totals, top shops, growing fast (up 20% or more), slowing down (down 20% or more, or no order for 14 days). Tap a shop for its progress report. `GET /api/admin/platform/shops-growth?days=30`.
- A shop, **Autopilot**: what it switched on, messages sent, customers who came back, and a switch **Stop Autopilot for this shop**. `GET/PUT /api/admin/tenants/:tid/autopilot`.
- More, Owner report settings: **Autopilot reminders** kill switch for all shops.

## 6. Tests
`backend/tests/autopilot.test.js` (23 tests): tags, the list, library checks (all languages, no unfilled words), settings, Remind, win-back steps and rest, quiet hours, opted-out customers, welcome / thank you once, meal time, festival, owner summary once, kill switches, "brought back", superadmin growth and pause.
