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

## B. Shop app (when the screens exist)

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
