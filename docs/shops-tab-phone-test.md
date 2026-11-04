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
