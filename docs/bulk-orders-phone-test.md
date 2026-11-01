# Bulk orders, step 1 (request and quote): phone test

Deploy the server first, then update the app (JavaScript only, no new APK). Needs the Services switch ON for the shop.
Payments are NOT part of this step: after the quote the customer can ask for a change or cancel; paying the advance comes next.

## Owner phone
- [ ] Menu -> open a dish -> **Bulk price**: type `30` pieces and `10` % off. Save. Open it again: both are still there. Clear both: saves with no bulk price. Fill only one: it refuses.
- [ ] More -> Shop hub -> **Bulk orders** -> **Bulk order rules**: switch on, minimum order Rs 5000, notice 24 hours, delivery fee "Same for all" Rs 300, packaging Rs 100, advance 50 %. Save.

## Customer phone
- [ ] Account -> Services: **Bulk order** is on top (and **My bulk orders**). It is not there while the owner has it switched off.
- [ ] Pickup / Delivery. Pick a day and a time. Delivery asks for a saved address.
- [ ] A dish with Half and Full shows a counter on each. A dish without options shows one counter. Type `40`, hold + for 10 at a time.
- [ ] A dish with several questions: "Choose options and add".
- [ ] The total at the bottom changes by itself. A dish with a bulk price shows "bulk price, was ..." once its quantity is reached, and "You save ...".
- [ ] Below the minimum order, or too soon: a red line says why and the button waits.
- [ ] Fill the contact, company and GST number (15 characters), send. It opens the order page: "Waiting for the shop's quote".

## Owner phone again
- [ ] A notification "New bulk order request"; tapping it opens the order. A red dot on the list.
- [ ] Prices are filled in (bulk price where the dish has one). Change one, remove one, add a discount, change the delivery fee and the advance %. Send the quote.

## Customer phone again
- [ ] A notification "Your quote ... is ready". The order page shows the whole bill, the advance to pay now and the balance.
- [ ] **Ask for a change** sends a note; the owner sees it in red and quotes again.
- [ ] **Cancel this request** works; after the owner declines, the reason shows.

# Step 2: the advance payment and refunds

Needs the shop's online payments switched on (Razorpay keys saved, tested, webhook secret made, "enabled"), same as for a table deposit. Test with TEST keys first.

## Paying
- [ ] On a quote: **Accept and pay Rs X now**. The text under it says the cancel rule ("cancel at least N hours before..."). The payment screen opens; pay with a UPI app and with a card.
- [ ] After paying the order shows **Confirmed**, "Advance paid", and the balance line. The owner gets "Bulk order confirmed".
- [ ] Close the app right after paying: reopen. The order is confirmed (the server asked Razorpay by itself).
- [ ] Pressing Back out of the UPI app: the order stays "Quote received" and you can pay again.

## Cancelling
- [ ] Customer, far ahead of the time: **Cancel this order** says "You will get Rs X back as a refund". After yes: cancelled, a push "Refund for bulk order", the Razorpay dashboard shows the refund.
- [ ] Customer, inside the cutoff (change the time on the order so it is less than N hours away): the popup says "Too late for a refund ... the shop keeps your advance". No refund appears in Razorpay.
- [ ] Owner on a confirmed order: **Cancel and refund the advance** with a reason: always the whole amount back, even inside the cutoff. The customer gets a push.
- [ ] Owner changes the "full refund" hours afterwards: an order already quoted keeps the hours it was quoted with.

## Odd cases
- [ ] Customer cancels a quote while a payment is open, then pays: the money is refunded by itself and the order stays cancelled.
- [ ] Owner sends a new quote while the customer pays the old one: the old payment is refunded, the new quote stays open.
- [ ] A shop with no Razorpay balance: the refund waits as "not sent yet" on the owner screen; the owner gets one message to add balance; after adding, it goes out within a few minutes.
- [ ] Razorpay dashboard: the webhook has `payment.captured` ticked (also `refund.processed`, `refund.failed`).
