# Real-time sync between a person's devices (web phase 12)

Anything a person changes on one logged-in device (the phone app, the website, a second phone or browser) shows on their other devices within about a second.

## How it works (one rule for the whole app)
1. **Server** (`backend/src/middlewares/syncNotify.js`): after ANY successful change (POST / PUT / PATCH / DELETE) by a logged-in person, the server sends `sync:changed { area, sid }` to that person's devices.
   `area` is the first part of the address (`addresses`, `me`, `me/alerts`, `favourites`, `cart`, `orders`, `bookings`, `shop:products`, `rider`, `staff`...). `sid` is the session that made the change.
   Changes under `/api/shop/...` also go to every owner device of the shop.
   Not announced: logins, uploads, the platform admin, notification reads and chat (they already have their own live messages), and the rider's position (many times a second).
2. **Each device** (`mobile/src/utils/common/syncEvents.js`):
   - ignores the message when it made the change itself (its session id);
   - reloads the data stores of that area (`utils/common/syncWiring.js`: profile, addresses, favourites, alert switches, cart);
   - makes every screen that loads when it comes into view load again (`hooks/common/useLiveFocus.js`, used by all 70 such screens: customer, owner, kitchen, waiter, rider);
   - **never refreshes while a text field is being typed in**: it waits until the person leaves the field, so a refresh cannot wipe what they are writing;
   - after a break (connection back, tab or app in front) refreshes once, in case a message was missed.
3. **Cart** (`backend/src/routes/cartRouter.js`, `models/Cart.js`, the cart store): a logged-in customer's cart is kept on the server too. A change is sent a moment after it is made; the other device fetches it. The last change wins.
   At start or login a cart already on the device is sent up; an empty one takes the server's. Placing an order empties it on every device. A guest's cart stays on the device.

## What was already live before this phase (unchanged)
Order and kitchen status, menu and shop setting changes, chat (messages, ticks, deletes), notifications read / cleared, the unread badges.

## Left per device on purpose
- A voice or tone setting (the app only), the appearance (light / dark), the language chosen on this device before login.
- The payment method and coupon picked while checking out (a choice for this checkout, not data).
- The "Get the app" bar being closed on a browser.

## Known limits
- A screen that was changed by hand but not yet saved (a switch flipped, not typed) can be reloaded by a refresh; typed text is protected.
- Messages are sent while a device is connected; a device that was offline refreshes when it reconnects or comes to the front.

## Two-device test list (the same login on a phone and a browser)
1. **Cart:** add a dish on the phone: it appears in the website's cart panel within a second or two. Change the quantity on the website: the phone follows. Place the order on one: both carts empty.
2. **Addresses:** add or edit an address on the phone: the website's address list shows it. Delete it on the website: it goes from the phone.
3. **Profile:** change the name or picture on one: the other shows it (Account page).
4. **Favourites:** heart a dish on one: the other shows the heart.
5. **Alerts:** switch an alert off on one: the other's Alerts screen shows it off.
6. **Owner (two owner devices):** accept an order, edit a menu item, add a rider, change a shop setting: the other device shows each change without leaving the screen.
7. **Typing:** on the phone start typing in any text field; change something on the website: nothing under your fingers changes; leave the field and the screen refreshes.
8. **Offline:** turn the phone's internet off, change things on the website, turn it back on: the phone catches up.
