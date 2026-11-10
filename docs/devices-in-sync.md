# Devices stay in step (web phase 4)

The server is the one truth. When something is read or cleared on one phone or browser, the person's other devices are told at once.

## What is live now
| What | How |
|---|---|
| A new notification, chat message, order or kitchen change | already live (Socket.IO rooms), unchanged |
| A chat sent from my other device, delivered / read ticks, deletes | already live (`chat:message` with `echo`, `chat:status`, `chat:deleted`) |
| **Notifications read or cleared on another device** | NEW `notification:read` `{ ids }` or `{ all: true }`, plus `unread` = what is left. Customer, rider, cook, waiter: to that person's devices. Owner: to every owner device of the shop (the owner inbox is shared). |
| **A chat read on another device** (bulk order, booking, inquiry) | NEW: the read note (`chat:status`, `echo: true`) is now sent for every kind of chat, not only inquiries. The badge on the other device clears. |
| **Back after a break** | NEW `resync`: when the connection comes back, or the app / browser tab comes back to the front, the bell number and the chat badges are fetched again (an event may have been missed while away). |

Files: `backend/src/routes/notificationRouter.js`, `backend/src/services/chat.js`, `mobile/src/api/common/socket.js` (onNotificationRead, onResync), `mobile/src/utils/common/push.js`, `mobile/src/hooks/common/useChatSync.js`, `mobile/src/screens/common/NotificationsScreen.jsx`. Tests: `backend/tests/syncEvents.test.js`.

## Left as it is on purpose
- **The cart is per device.** A phone cart and a browser cart do not merge (normal for ordering apps). A synced cart is a separate decision.
- Opening the inbox is what marks everything read (the existing behaviour), so "read" on one device clears the bell everywhere.

## Test list (a phone and a browser, same login)
1. Have an unread notification on both. Open **Notifications** on the phone: the bell on the browser drops to 0 within a second or two.
2. Do it the other way round (open it in the browser).
3. With the Notifications screen open on one device, open it on the other and press **Clear all**: the list on the first device empties.
4. Owner: two owner devices; read the inbox on one, the bell on the other clears.
5. Customer: have an unread chat message about a bulk order or booking on both. Open the chat on the phone: the chat badge on the browser clears.
6. Switch the phone to airplane mode, read the inbox on the browser, switch the phone back: the bell on the phone corrects itself after reconnecting (or when you bring the app to the front).
7. Browser: leave the tab in the background, read on the phone, come back to the tab: the bell is right.
