# Shops tab: phone tests

## Phase 1: live message and the paused screen
Needs the server redeployed and the shop app installed with the new JS (OTA or a new build).

1. Open the customer app on a shop (logged in). In the superadmin app open that shop, Access and maintenance, Start maintenance, write "Testing the pause", save.
   - Within a few seconds the customer app shows the dimmed screen with one card: "Back soon", "Testing the pause". It must not need a tap or a refresh.
   - The owner of that shop gets a push and an inbox line: "Your shop is paused for maintenance".
2. Open the owner, cook, waiter and rider apps of the same shop (each logged in) before step 1. Each shows the card. The cook, waiter and rider see their own wording only when it is a suspension (maintenance shows your message to everyone).
3. Turn maintenance off in the superadmin app. Within 20 seconds every app is back to normal by itself, and the owner gets "Your shop is back".
4. Start maintenance with an end time 2 minutes ahead. Do nothing. The apps come back by themselves after the end time.
5. Block the owner panel (Access and maintenance). The owner gets "Your shop panel was locked" with no reason in it. Allow again: "open again".
6. Change a setting quietly (for example the minimum order). Open apps update with no message to the owner.
7. Turn the phone's internet off in the customer app: a dark "no connection" strip shows, and it goes away when the internet is back.
8. Suspend the shop (Edit shop, Suspended): customer sees "Closed for now", cook or waiter or rider sees "Shop is closed. Please contact the owner."

Note: the dimming is a see-through overlay, not a real blur (a real blur needs the expo-blur module and a new app build).

## Phase 2: Close shop
Needs the server redeployed, the superadmin app and the shop app updated.

1. Superadmin, a shop page, Manage, "Close this shop". Without a reason the red button stays off. Pick "Other reason", write one, Close. The customer, owner, cook, waiter and rider apps of that shop show the closed card within seconds ("Closed for now" for customers, "Shop is closed. Please contact the owner." for staff). The owner gets a push "Your shop is closed" with no reason in it.
2. The shop appears under the Shops chip "Closed". Its page shows "This shop is closed". Menu, orders and bills are still there.
3. Open the shop again from the same page: with no rent due it just asks to confirm. With rent due it first says "Rent is still due ... Open anyway?" and only opens when you confirm.
4. Close a shop with an order in progress: the screen shows "1 order is in progress". Choose "Let them finish first": new orders stop, the shop closes by itself when the order is delivered. Choose "Cancel them now": the order is cancelled and refunded.
5. Close a shop with reason "Rent unpaid". Open the owner app: the closed card says rent is unpaid, shows "Rent due: Rs ...", and "Open Rent page" opens the rent page, where he can pay. When he pays everything, the shop opens by itself within a minute or two and the owner gets "Your shop is open again". A shop closed for another reason does NOT open by itself.
6. A closed shop gets no new rent bills and no new late fees.
7. Shops to close: make a test shop with a rent bill due more than 6 months ago (or lower the number in Billing rules). Home shows "1 shop may need closing" in Needs you now, you get a push and an alert (once a week per shop). Tap it: the list shows the shop (a brand's branches together, with "Close all N branches"). Nothing closes until you press Close.
8. Billing rules has a new line "List a shop for closing after unpaid months" (default 6).

## Phase 3: shops list and the shop page
1. Shops tab: the chips are All, Taking orders, Rent due, No orders 14 days, Needs attention, Free period, Closed (each with a count) and "Group brands". Tap each; the list narrows to the right shops.
2. Every row shows "N orders today", "last order 2 h ago" (amber when quiet) and "Rent due Rs ..." (red when overdue). A brand's name shows before the shop code.
3. Header icon (sliders): Sort the shops. Try Most orders today, Most rent due, Quietest first, Newest, A to Z. The default puts problems on top and closed shops last.
4. "Group brands" on: a brand's branches are one row ("Savera, 3 branches, 12 orders today, Rent due Rs ..."). Tap it to open the branches; tap a branch to open that shop. Typing in the search box shows a plain list.
5. Open a shop: the page shows its status, the delivery-area warning if any, the four quick buttons, then ONE card "Everything about this shop" with six rows: Running now, Money, Menu and offers, Settings, People, Shop control. Each has a plain one-line description.
6. Open each folder. Check that every old page is still reachable: Live activity, Orders, Riders and cash, Complaints, Services and booking, Bulk orders, Messages to customers, Autopilot, Progress report, Sales report; Billing and rent, Rent invoices, Online payments, SMS wallet, Transactions; Menu, Collections, Banners, Coupons, Points and rewards; Owners, Users, Message the owner; Edit shop, Close this shop, Access and maintenance, Activity log, Branding, Development details. "Shop control" also holds who brought the shop, Make this shop a brand, and the handover.
7. Settings: the phone preview on top, then Ordering, Dine in pickup and staff, Riders and delivery, Features, How the customer app looks, App version and alerts. "Words and language" is gone.
8. Search "words" no longer finds a Words and language screen; search "close" finds Shops to close.
