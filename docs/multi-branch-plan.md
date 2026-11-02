# Multi-branch plan (Brand with branches)

Status: PLAN ONLY, agreed 2026-11-03, nothing coded. Do not code until the user says "start".

## 1. Structure
- Brand "Savera" -> branches (Delhi, UP, Mumbai). Each branch is a normal tenant (own menu, stock, staff, riders, orders, hours, location, Razorpay keys).
- The Brand is a new layer above: owner, shared SMS wallet, combined invoice, combined dashboard.
- A shop without branches is unchanged and sees nothing new.
- Branch location and radius are one record (tenant.delivery lat/lng/radiusKm), the same for superadmin, owner and manager. Idea: show who last changed it; optional lock so a franchise owner cannot widen it.

## 2. Control
| | Supreme admin | Other superadmins | Brand owner | Branch manager | Cook/waiter/rider |
|---|---|---|---|---|---|
| See all branches | Yes | Yes | Own brand | Own branch | Own branch |
| Change anything | Anywhere | Areas open to them today | Own brand, except keys/rent/discount | Own branch | Their job |
| Create brand, branch count | Yes | No | Can request a branch | No | No |
| Razorpay keys, rent tier, discount | Yes | No | No (sees which account each branch pays to) | No | No |
| Appoint brand owner | Yes | Yes (today's rules) | No | No | No |
| Appoint branch managers | Yes | Yes | Yes | No | No |
| Appoint cook/waiter/rider | Yes | Yes | Any branch | Own branch | No |
| Move person to another branch | Yes | Yes | Yes (blocked with live work) | No | No |
| Push menu to branches | Yes | No | Yes | No | No |
| Top up SMS wallet | Yes | Yes | Yes | No | No |
- One person belongs to one branch only (same phone refused at a second branch: "already works at Savera Delhi"). Moving needs no live work; history stays with the old branch; audit logged.
- All changes go to the audit log (who, which branch, when).

## 3. Panels
- Supreme admin: "This shop has branches" switch; Brand page (branches, city, location status, Razorpay status, orders this month, go-live checklist: location, keys, owner invited, Go live); Add branch form (name, city, manager phone, keys or "same as main", optional rent override); brand settings (branch limit, discount %, SMS wallet and usage).
- Brand owner: today's owner panel + branch switcher + "All branches" combined panel (view and totals, rows labelled by branch, filter by branch; edits happen inside a branch) + brand-wide actions (menu push, announcements, SMS top-up, combined invoice).
- Branch manager: today's owner panel locked to one branch.

## 4. Customer
- One app. Uses location, opens the nearest branch that delivers there.
- A branch with no radius is NEVER shown (the current rule "no radius = serves everywhere" must not apply to branches).
- Server enforces on cart, orders, bulk, bookings, inquiries.
- App identifies the shop by x-tenant-slug and users belong to one tenant: customer signs in once, account created at each branch on first use (to design in phase 7).

## 5. Menu and stock
- New branch gets a starting copy of the main menu; then each branch edits its own. Local dishes stay local.
- Stock and sold-out never shared.
- Brand owner can push a dish to all or selected branches; branch can hide it. Prices stay per branch unless the owner chooses to update branches that have not changed theirs.

## 6. Money and billing
- Online payments: each branch has its own Razorpay keys, set only by the supreme admin (same keys on two branches = same account).
- Rent: existing tiers (3000 up to 305 orders/month, 6000 for 306-1005, 10000 above) counted PER BRANCH, per-shop overrides kept.
- Multi-branch discount: off by default, set by supreme admin per brand, suggested 10% with 15% cap, rent only, 2nd branch onward, own invoice line.
- One invoice per brand per month, a line per branch.
- SMS: one shared brand wallet; invoice lists approximate SMS used per branch (information only, prepaid).
- Loyalty and coupons: per branch; a "share across brand" switch later.

## 7. Phases
1. Brand layer: brand + branch link, switch, Brand page, Add branch + go-live checklist, one-person-one-branch rule.
2. Location rules: pin and radius, location-based branch pick, server checks on all order types.
3. Roles and panels: brand owner, branch manager, branch switcher, move people.
4. Combined "All branches" panel.
5. Menu: starting copy, push, overrides.
6. Billing: brand invoice, discount, shared SMS wallet, SMS usage per branch.
7. Customer login across branches and automatic branch switching.
8. Isolation test (Hyderabad customer/rider/owner refused on every Mumbai record: bulk, booking, inquiry, chat, coupon...) and phone test.
Phases 1, 2, 8 are the safety core.

## 8. Open
- User to say "start" for phase 1 (only thing left).
- Discount CONFIRMED 2026-11-03: default 10%, cap 15%; supreme admin can change both the default, the cap and the per-brand value.
