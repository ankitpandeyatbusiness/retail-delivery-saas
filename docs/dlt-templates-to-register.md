# SMS (DLT) templates to register

Every SMS the app sends must be a message you registered and got approved on the DLT portal. The text you register must be **exactly** the text below, with `{#var#}` in each place a value changes. If a text is changed in the code, change it here and on DLT too (or the SMS is blocked).

- Where the texts live in the code: `backend/src/notifications/templates/sms.js` (all messages) and `backend/src/services/adapters/sms.js` (`OTP_TEXT`, the login OTP).
- A `{#var#}` value is cut to **30 characters** by the code (a DLT limit).
- Messages are sent by MSG91 on the transactional route, with your sender ID and entity ID.

## 1. What you register on DLT (once)

| What | Where it goes on the server |
|---|---|
| Entity ID (your registered business) | `SMS_ENTITY_ID` |
| Sender ID / header (6 letters) | `SMS_SENDER_ID` |
| MSG91 auth key | `SMS_AUTH_KEY` |
| Template ID of each text below | `SMS_TEMPLATE_<NAME>` (see the Name column) |
| One fallback template ID (optional) | `SMS_DEFAULT_TEMPLATE_ID` |
| Turn real SMS on | `SMS_MOCK=false` |
| MSG91 balance address, only if it differs (optional) | `SMS_BALANCE_URL` |
| Name used in the superadmin login OTP (optional) | `SMS_BRAND_NAME` |

`DLT_TEMPLATE_<NAME>` is read too, so either spelling works. These are server settings, not app screens. Restart the server after changing them. A shop with its **own** provider account has its own sender, entity, key and template IDs on its page in the superadmin (SMS provider).

## 2. The texts to register

Register each text as a **transactional / service** message. The Name column is the `<NAME>` in `SMS_TEMPLATE_<NAME>`.

| # | Name | Who gets it | Register exactly this |
|---|---|---|---|
| 1 | `OTP` | customer, shop owner, rider, staff (login) and you (superadmin login) | `Your OTP for {#var#} is {#var#}. Valid for 5 minutes. Do not share it.` |
| 2 | `ORDER_NEW` | shop owner | `New order #{#var#} (Rs {#var#}) at {#var#}. Please open the app to accept it.` |
| 3 | `ORDER_ACCEPTED` | customer | `Your order #{#var#} from {#var#} was accepted.` |
| 4 | `ORDER_OUT_FOR_DELIVERY` | customer | `Your order #{#var#} from {#var#} is on the way.` |
| 5 | `ORDER_DELIVERED` | customer | `Your order #{#var#} from {#var#} was delivered. Thank you!` |
| 6 | `ORDER_CANCELLED` | customer | `Your order #{#var#} from {#var#} was cancelled.` |
| 7 | `ORDER_UNACCEPTED_REMINDER` | shop owner | `Order #{#var#} at {#var#} is still waiting to be accepted. Please open the app now.` |
| 8 | `DELIVERY_PIN` | customer | `Your {#var#} delivery PIN for order #{#var#} is {#var#}. Tell it to the delivery partner at your door.` |
| 9 | `RIDER_SOS` | shop owner | `Rider {#var#} of {#var#} pressed the help button. Call him now on {#var#}.` |
| 10 | `BILL_ISSUED` | shop owner | `New bill {#var#} of Rs {#var#} for {#var#}. Please pay by {#var#} to keep taking orders.` |
| 11 | `BILL_OVERDUE` | shop owner | `Rs {#var#} is overdue for {#var#}. Pay now in the app to stop the late fee from growing.` |
| 12 | `SHOP_PAUSED` | shop owner | `Your shop {#var#} is paused because a bill is unpaid. Pay now to start taking orders again.` |

What goes in each `{#var#}`, in order:

1. **OTP**: the shop name, then the 6-digit code. The superadmin login uses `SMS_BRAND_NAME` (or "your account") as the name.
2. **ORDER_NEW**: order number, total, shop name.
3. **ORDER_ACCEPTED / OUT_FOR_DELIVERY / DELIVERED / CANCELLED**: order number (for example `1042`), shop name.
4. **ORDER_UNACCEPTED_REMINDER**: order number, shop name.
5. **DELIVERY_PIN**: shop name, order number, the PIN.
6. **RIDER_SOS**: rider name, shop name, rider phone.
7. **BILL_ISSUED**: invoice number, amount, shop name, pay-by date.
8. **BILL_OVERDUE**: amount, shop name.
9. **SHOP_PAUSED**: shop name.

The shop name is filled in automatically for every shop, so one registered template serves all shops.

## 3. Your own alerts to your phone (optional)

If you switch on "SMS to my phone" for critical platform alerts, the text sent is:

`Platform alert: {#var#}. Open your panel for details.`

Register it too. It has no name of its own in the code, so it uses `SMS_DEFAULT_TEMPLATE_ID`. The part in the variable is a short sentence such as "Shop paused: Savera" and can be longer than 30 characters, so ask your DLT portal whether a longer variable is allowed for it.

## 4. If the operator wants different wording

- The login OTP often needs the brand name in the text. If your DLT portal approves other wording, change `OTP_TEXT` in `backend/src/services/adapters/sms.js` to the approved text, keeping `{name}` and `{otp}` where the two `{#var#}` go.
- If shop names inside the OTP are not accepted, use one fixed app name instead of the shop name: `Your OTP for <YourApp> is {#var#}. Valid for 5 minutes. Do not share it.`
- For any other text, change it in `backend/src/notifications/templates/sms.js` and keep the order of `vars` the same as the order of `{#var#}`.

## 5. Checklist when you go live

1. Register the entity, the sender ID and every text above on DLT, and note each template ID.
2. Create the MSG91 account and note the auth key.
3. Set the server settings in section 1 and restart the server.
4. Superadmin: Money > SMS balance > **Ask the provider now**. If the number is in SMS credits and not rupees, switch the unit and ask again.
5. Send a login OTP to yourself and check the text on your phone matches the registered one.
6. Trigger one order SMS and one bill SMS and check them too.
