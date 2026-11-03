# Multi-branch: phone test

What the computer tests already prove (tests/brands, brandOwner, brandPanel, brandMenu, brandBilling, customerBranch, branchIsolation): the server rules.
What only a phone can prove: the screens. The shop-app screens for branches are NOT built yet (see docs/multi-branch-plan.md, phase 7), so
this list has two parts: A can be done today in the superadmin app, B is for when the shop-app screens exist.

Use two test branches of one brand, for example "Test Delhi" and "Test Mumbai", and a second, unrelated brand for part C.

## A. Superadmin app (today)

A1. More -> Brands and branches. New brand "Test Brand", limit 3. It opens the brand page.
A2. Add a branch "Test Delhi" (city Delhi, a manager phone of yours). It shows "Setting up" with the four steps: pin and radius, Razorpay keys, owner, live. Only "Owner or manager added" is ticked.
A3. Add "Test Mumbai" with "Start from the look, rules and menu" ticked. Open its shop: the dishes of Test Delhi are there (own copies, no stock count, no ratings).
A4. Try to add a 4th branch: refused ("limit of 3"). Raise the limit to 4: now it works. Lower it below the branch count: refused.
A5. Brand owners -> Add a brand owner (a third phone). Check in "Shops" that this phone is owner of both branches. Remove it: it is no longer owner of either.
A6. Try the same phone as a rider in Test Delhi and then as brand owner: refused with the job named.
A7. Try to make the manager phone of Test Delhi owner of Test Mumbai too: refused, "already works at Test Delhi".
A8. Go live on a branch with no map pin and radius: refused. Set pin and radius in the shop settings, then Go live works.
A9. Rent discount: Brand page -> Rent discount 10. Try 20: refused (cap 15). Next month's rent invoices of the 2nd branch show a "Multi-branch discount 10%" line; the first branch pays full.
A10. After bills exist, the brand page shows "Statement for <last month>": a line per branch, the discount, unpaid amount, and about how many SMS each branch used.
A11. SMS wallet: top up the wallet of one branch by Rs 100. The other branch shows the same balance. Send an OTP at the other branch: both show the lower balance.
A12. Take the oldest branch out of the brand: the SMS money goes to the next branch, the shop stays a normal shop with an empty wallet.

## B0. First, on an ORDINARY shop app (no branches) - the foundation touches login and network for every shop

B0.1 Fresh install, sign in with OTP, close the app fully, open it again: still signed in.
B0.2 Orders, menu and live updates work as before; push arrives; the Soundbox works (owner).
B0.3 Log out, sign in again; a different phone number works too.
B0.4 Kill the app, switch the phone off and on, open: signed in, the shop's look appears.
B0.5 The owner side menu shows NO branch box.

## B. Shop app (all written, none of it run on a phone yet)

B1. Customer, first open of the brand app: it asks for the location and opens the nearest branch that delivers there. A branch with no radius is never offered.
B2. Customer in Delhi switches to Mumbai: no second login. The cart, menu, addresses and orders are Mumbai's, empty at first. Switch back: the Delhi cart and orders are still there.
B3. Customer at an address outside every branch: a clear "we do not deliver here yet" message.
B4. Customer places an order in Mumbai: only the Mumbai owner, cooks and riders are alerted. Delhi gets nothing.
B5. Brand owner: sees the branch switcher; switching opens the other branch's owner panel without a new OTP. A plain branch manager sees no switcher.
B6. Brand owner -> All branches: today's orders and sales per branch, and the total; filter by branch; tap an order to open that branch.
B7. Brand owner pushes a dish to the other branch: it appears there; the other branch's price and stock stay. A dish the other branch hid stays hidden.
B8. Brand owner moves a rider from Delhi to Mumbai: the rider logs out of Delhi and logs into Mumbai. A rider with a trip in progress cannot be moved.
B9. Push notifications and the Soundbox: an order at Mumbai is heard only on Mumbai phones.

## C. Two brands (isolation)

C1. The owner of the second brand opens the brand screens: only their own branches and orders are visible.
C2. Nothing of the first brand can be opened from the second brand's app, by link or by switching.

## D. Alerts by branch (brand owner)

D1. Brand owner opens the side menu -> Alerts by branch: a switch for every branch, a master switch "Alerts from every branch" (off), and "I manage this branch myself" under each branch.
D2. Tick "I manage this branch myself" on Delhi. An order at Delhi rings his phone, even while he has Mumbai open. The alert title starts with the branch name ("Savera Delhi - New order") and the Soundbox says the branch first.
D3. With Mumbai muted: a new order at Mumbai does NOT ring or text him. It still shows in Notifications of all branches, greyed "Silent", with the branch name.
D4. Open Mumbai in the app (switch): Mumbai alerts now ring him; switch back to Delhi: Mumbai stops again (Delhi still rings).
D5. Switch Goa on by hand: Goa rings him. Master switch on: every branch rings. Master off again: back to the choices.
D6. A rider SOS or an order nobody accepted at a muted branch still rings him.
D7. Muting a branch that has no other manager shows a warning.
D8. The Mumbai manager (not a brand owner) is not affected by any of this and gets plain titles.
D9. While he looks at Mumbai, does Delhi (his own branch) still ring as a phone notification? Does its live slider and Soundbox also play? (Expected: the phone notification yes; the live slider only for the branch that is open.)

## E. Who pays

E1. The branch manager (not a brand owner) opens Monthly bill: the bills and amounts show, but there is no Pay now or Pay all; a note says the brand owner pays.
E2. The same manager opens the SMS screen: the balance and history show, but no Add money; the same note.
E3. The brand owner opens the same screens at that branch: Pay now, Pay all and Add money are there and work. A top-up shows in every branch (one wallet).
E4. An ordinary single shop: nothing changes, the owner pays as before.

## F. Moving people with live work

F1. A cook has started an order (not ready yet): moving him to the other branch is refused with "making order #N right now". Mark it ready: the move works.
F2. A waiter has an open table or a table waiting to pay: the move is refused with how many tables. Close the tables: the move works.
F3. A rider with a trip in progress: the move is refused (as before).

## G. All branches: customers, complaints, ratings

G1. All branches page: a Customers card (people, new, ordered, and how many people use more than one branch), then one line per branch.
G2. Open complaints: the count per branch and the newest five; tapping one asks to open that branch.
G3. Dish ratings: the average and count per branch and the newest low ratings with dish and branch.
G4. Change the range chip (7 or 30 days): customers and ratings follow it.

## H. Coupons, banners and collections

H1. Add a new branch copied from the main one: its Coupons, Banners and Collections screens show the main branch's live ones (own copies); a finished coupon is not there; used counts start at 0.
H2. Owner -> Send to branches -> Coupons: pick a coupon, send to all: the other branch gets it; if that branch already has the same coupon it is updated and keeps its own used count.
H3. A branch that already has a DIFFERENT coupon with the same code: it is skipped and the app says how many were skipped.
H4. Send a collection to a branch that lacks some of its dishes: it arrives with only the dishes that branch has.

## I. Pin and radius: who changed it, and the lock

I1. A branch manager changes the delivery distance: the owner Delivery screen then says "Last changed by <name> on <date>"; the Brand page (superadmin) shows the same with the job.
I2. Superadmin: Brand page -> Lock pin and radius on that branch. The manager tries to change the distance or move the pin: refused with "locked by the head office". Changing the minimum order or fees still works.
I3. The brand owner (in that branch) and a superadmin can still change it. Unlock: the manager can again.

## J. Statement PDF

J1. Superadmin: Brand page -> Statement card -> Share the statement PDF: a one-page A4 opens in the share sheet. Check: the brand and month on top, a row per branch (nothing cut off), the discount column, totals, Unpaid line, SMS wallet lines.
J2. Brand owner: All branches -> Rent bills card -> Open the statement (PDF): the same page opens.

## K. Free start of a brand

K1. Brand page -> Free start card: "New branches get no free start" by default. Add a branch and press Go live on it: its rent preview says the first rent is the NEXT full month (the go-live month is not billed).
K2. Press "Give new branches a shared free start": the card shows the orders used out of the free orders and how many branches are in it. Go live on two branches; place orders at both: the count adds them together.
K3. When the total reaches the free orders (or the months pass) both branches show rent starting the same month; "free ended" on both at the same moment.
K4. Add a branch while the shared free start runs: it shares what is left. Add one after it ended: no free time.
K5. "End the free start now" ends it for all at once.

## L. Paying for the branches

L1. Brand owner: All branches page -> Unpaid bills card: the total, and a line per branch that owes something.
L2. "Pay this branch" on one line: the payment screen opens for that branch only; after paying, only that branch's bills are paid.
L3. "Pay all branches": ONE payment; afterwards every branch's bills are paid and a branch that was paused for rent is open again.
L4. A branch manager does not see these buttons (he sees the note that the brand owner pays).
L5. Superadmin, Brand page -> Money actions for several branches: choose branches (or All), Waive late fees / Mark bills paid / Mark a month's bills not paid; the answer sheet lists each branch with what changed and anything skipped (a bill paid online is never undone).

## M. Attaching an existing shop

M1. Superadmin: Brands and branches -> a brand -> Add an existing shop: search lists only shops that are not in any brand.
M2. Pick one, type its city, Attach: it appears as a branch with its menu and orders unchanged; the brand owners can switch to it.
M3. A shop whose staff also work at another branch of this brand is refused with the reason.
M4. Its own SMS balance is now in the brand wallet.

M5. Superadmin: a shop page -> Make this shop a brand (name, city, optional owner phone): the brand is made, the shop is its first branch, the owner can switch branches. A shop already in a brand does not show the button.

## N. Platform health

N1. Superadmin: More -> Platform health opens. The top box is green "All fine", amber "Look when you can" or red "Act now", with one line why.
N2. "Needs you" lists every card that is not green, worst first.
N3. Rent card: shops that paid / total collected / shops still to pay / total to collect; overdue bills show red.
N4. SMS card: sent in 7 days, cost and price per SMS, profit.
N5. Orders card: today, 7 days (with  hange), last month.
N6. Google card: every call type with a bar; amber from 60
## N. Platform health

N1. Superadmin: More -> Platform health opens. The top box is green "All fine", amber "Look when you can" or red "Act now", with one line why.
N2. "Needs you" lists every card that is not green, worst first.
N3. Rent card: shops that paid / total collected / shops still to pay / total to collect; overdue bills show red.
N4. SMS card: sent in 7 days, cost and price per SMS, profit.
N5. Orders card: today, 7 days (with the change in percent), last month.
N6. Google card: every call type with a bar; amber from 60 percent, red from 90 percent.
N7. Tapping a card opens the matching screen (SMS profit, Receivables, System, Support, Shop health).
N8. Pull down to check again; the time of the last check is shown.

## O. The new home screen

O1. Superadmin Home: a search box on top; tapping it opens Search. Typing a brand name (for example Savera) lists all its branches.
O2. The coloured platform box (All fine / Look when you can / Act now) with a line why; tap opens Platform health.
O3. "Needs you now" lists what is not green, plus shop money still to answer for last month (supreme admin only), support waiting and unread alerts.
O4. Money this month: Collected and To collect, and the Shop money card with the developer's part.
O5. Today: orders and sales, and the last 7 days with the change in percent.
O6. One line for the highest Google call use, with its colour.
O7. Quick actions: New shop, Shop money, Brands, Alerts. The bell on top opens the alerts inbox.
O8. Log in as Vivyaan's (ordinary) superadmin: the same home, but no "Shop money to answer" item.

## P. The red-light push

P1. When a Platform health card turns red (rent with 3 or more overdue bills, orders down 40 percent, no backup, SMS losing money, and so on) every superadmin phone gets a push "Platform: Rent is red" with the reason, even with the app closed. Tapping it opens Platform health.
P2. The same card is not pushed again for 6 hours; if still red then, "red again" arrives.
P3. When it goes back to normal and later turns red again, you are told at once.
P4. Payment notices and a failing SMS provider keep their own older alerts and are not repeated by this one.

O9. Home: type in the search box on the home screen: the home content glides away and the matching shops, brand branches, orders, people, invoices and screens show right there. Clear the box (the x) and the home comes back. The old Search page still works and shows the same answers.

## Q. Back goes to where you came from

Q1. Home -> Needs you -> tap a shop -> the shop opens -> Back (the arrow on top, and the phone's Back key) returns to Home, not to the Shops list.
Q2. Home -> Quick actions -> Shop money (or Brands) -> Back returns to Home, not to the More menu.
Q3. Home -> type in the search box -> open a shop -> Back returns to Home with the search results still there.
Q4. More -> Platform health -> tap a shop -> Back returns to Platform health.
Q5. Orders -> an order -> its shop -> Back returns to that order. Inside the shop, opening Billing and pressing Back goes to the shop first, then Back again goes to where you came from.
Q6. Open a shop from the Shops list itself: Back is the normal Back to the list.
