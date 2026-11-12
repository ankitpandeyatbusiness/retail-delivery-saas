// The Terms of Service and the Privacy Policy of customers and of shop owners. They are written HERE and shown as they are: nothing to edit in an admin
// app, nothing to agree to in the apps (using the app means accepting; owners also sign a paper agreement). To change a text, change it here, change
// EFFECTIVE_DATE, add the translations (mobile/scripts/i18n-chunks) and deploy.
//   # heading    - bullet    1. numbered line    anything else is a paragraph    {{name}} is filled in (services/legal.js): the operator's details come from Platform business
// NOT legal advice: have a lawyer read them (the late fee and the liability sections especially).
const EFFECTIVE_DATE = '8 November 2026';
const HOURS = 'Support is open 10:00 AM to 5:00 PM, Monday to Friday (Indian Standard Time).';
// the contact block, the same in every document (Razorpay and customers look for these lines)
const CONTACT = `Business name: {{operatorName}}
Our address: {{operatorAddress}}
Write to us by email at {{contactEmail}}
Call us on {{contactPhone}}
${HOURS}`;

const DOCS = {
    customer_terms: {
        audience: 'customer',
        title: 'Terms of Service',
        body: `# Terms of Service
Effective {{effectiveDate}}. These terms apply when you use this app to order from a shop. By using the app you accept them.

# 1. Who we are
{{platformName}} is a product of {{operatorName}}, which runs the business and looks after billing and compliance. The technology is provided by an independent developer.

# 2. The shop and your order
This app lets you order from the shop whose app you opened. The food, its price, its taxes and its delivery are the responsibility of that shop. We only provide the app that connects you with the shop. The total is shown before you place an order.

# 3. Your account
You sign in with your mobile number and an OTP. Keep the OTP to yourself. You can change your details or delete your account any time in your profile.

# 4. Prices and payment
- Menu prices and the delivery fee are set by each shop. The delivery fee, any packaging charge and the taxes are shown in your total before you place the order. You never pay anything that was not shown.
- {{platformName}} does not charge customers anything extra for using the app.
- You can pay cash on delivery or online (UPI, card or wallet), depending on what the shop offers. Online payments are processed securely by our payment partner Razorpay. We do not see or store your card details.

# 5. Cancellation and refund policy
Cancelling an order
- Cash on delivery orders: you can cancel in the app, free of charge, until the shop starts preparing your order.
- Online payment orders: you can cancel in the app while your order is active (placed, accepted, being prepared, ready or on the way). The app shows how much you will get back before you confirm.
- A table guest may cancel a round of food in the first few minutes after ordering, in case it was ordered by mistake.
- Once an order is delivered it cannot be cancelled. If something is wrong, use the complaint option in the app within 24 hours of delivery.
How much is refunded
- If the shop cancels your order or cannot deliver it, you get a full refund of what you paid online.
- If you cancel an online order yourself, the refund depends on how far the order has gone. Cancelling soon after placing it, or before the shop accepts it, is refunded in full. After the shop has started preparing or sending your food, the shop may keep a share of the amount for the food already made. The shop's rule is shown in the app before you confirm the cancellation.
- If a payment is taken but the order cannot be created or was already cancelled, the full amount is refunded automatically.
- If you paid cash on delivery, nothing is charged and nothing needs to be refunded.
How and when the refund is paid
- Refunds for online payments are sent back to the same payment method you used (UPI, card or wallet). We cannot refund to a different account.
- A refund is started as soon as the order is cancelled or a complaint is approved. It reaches your account in 5 to 7 working days. Some banks may take a little longer.
- You can see the status of your refund in your order details in the app.

# 6. Shipping and delivery policy
- Your food is made and delivered by the shop you order from. {{platformName}} provides the app that connects you with the shop and its delivery partner.
- The estimated time is shown in the app before you place your order and while you track it. The time depends on the shop, how busy it is, and the distance. It is an estimate and not a guarantee. You can follow your order and your delivery partner on a live map.
- Each shop delivers only inside its own delivery area. Enter your address in the app: it tells you straight away if the shop does not deliver there.
- Please give a correct address and phone number and be ready to receive the order. A 4-digit delivery PIN, shown in your app, may be asked at the door.
- If you cannot be reached or are not available, the shop may cancel the order and may keep a share of the amount as explained in the cancellation and refund policy above.
- Pickup orders are collected from the shop in the time slot you choose. Table orders are served at your table.

# 7. Problems and complaints
Open the order in the app and use the complaint option. The shop reviews it and replies in the app. If the shop decides to refund, the refund follows the timeline in section 5.

# 8. Fair use
Please do not misuse the app or give false information.

# 9. Contact us
${CONTACT}
We reply to emails within 2 working days.

# 10. Changes
We may change these terms. The latest version is always in the app and on our website. Using the app after a change means you accept it.`,
    },

    privacy: {
        audience: 'customer',
        title: 'Privacy Policy',
        body: `# Privacy Policy
Effective {{effectiveDate}}. This explains what we collect and why. By using the app you accept this policy.

# Who we are
{{platformName}} is a product of {{operatorName}}, which looks after your data. The technology is provided by an independent developer who works on the servers only to run and repair the service. This app lets you order from the shop whose app you opened.

# What we collect
- Your mobile number, and your name and email if you give them.
- Your delivery addresses and, if you allow it, your location to find your address.
- Your orders, payment status, ratings, complaints and messages.
- Your phone's notification address and basic details such as the app version.
- Riders: name, phone, deliveries and, while you have an order, your location.
- Shop owners: business details and billing records.
- If you try our demo and choose to leave your name, shop name and mobile number, we keep them so that we can call you about the service. Ask us and we will delete them.

# Why we use it
To run the service: sign you in, take and deliver orders, take payments, send OTPs and order updates, and give shops their reports. We do not sell your data and we do not show ads from other companies.

# Who can see it
- When you order from a shop, that shop sees your name, phone, address and orders.
- The rider delivering your order sees your name, phone, address and the order.
- Companies that send SMS and notifications, take payments and host our servers, only to do that work.
- Authorities, if the law requires.

# How long we keep it
Bills and orders are kept as long as the law requires. Other data is kept while your account is open. If you delete your account, your profile, addresses and logins are deleted.

# Your choices
You can change your details, turn offers off and delete your account in your profile. For any question about your data, contact us below.

# Safety
Your data is kept on secured servers and sent over encrypted connections. If we find a leak that affects you, we will tell you.

# Children
The app is not meant for children under 18 without a parent.

# Contact
${CONTACT}

# Changes
We may change this policy. The latest version is always in the app and on our website.`,
    },

    owner_terms: {
        audience: 'owner',
        title: 'Terms of Service for Shop Owners',
        body: `# Terms of Service for Shop Owners
Effective {{effectiveDate}}. These terms are between you (the shop) and the operator of {{platformName}}. By using the app as a shop owner you confirm that you are the owner (or authorised by the owner) of the shop and accept these terms. They are also covered by the written agreement you sign with the operator.

# 1. Who provides the service
- {{platformName}} is a product of {{operatorName}}, {{operatorAddress}}{{operatorGstin}}. This is the "Operator". It runs the business and is responsible for billing, tax and compliance. Bills and receipts come in the Operator's name, and your plan, wallet and SMS payments go to the Operator.
- The technology behind the app is provided to the Operator by an independent developer.

# 2. What you get
A customer ordering app for your shop (on a website and in the app), an owner panel (orders, menu, riders, money, reports), a rider app, and notifications by app, SMS and email. What is included depends on your plan. The Plan screen in the app lists what each plan gives.

# 3. Plans and payments
- There are three plans: Partner, Growth and Pro. Partner has no monthly price: a small fee per completed order (Rs 3 to Rs 15, depending on the order value) is taken from your prepaid wallet. Growth and Pro have a monthly price, paid in advance for 1 to 6 months. In Pro, shops beyond the ones included in your plan are an extra monthly add-on.
- Everything is prepaid. We do not send bills after the fact and we do not charge late fees.
- Your shop may start with a free period. When it ends you choose a plan and pay to continue.
- Plan prices, features and fees may change. A change does not affect the term you have already paid for.
- If your plan ends and is not renewed, we remind you before the end and after a short grace period your shop is paused for new orders. Orders in progress can still be finished.
- Orders taken through the platform are to be completed in the app, and the fee (Partner) or plan (Growth, Pro) applies to them. We may suspend a shop that avoids the platform to skip fees.
- GST is added on plan payments, add-ons and wallet top-ups when the Operator has a GST registration. A shop with a GST number can use the invoice for input credit.
- A one-time setup fee applies when your shop joins. It is non-refundable and is charged outside the app.

# 4. How you pay the Operator
- Plan payments, extra shops, wallet top-ups and SMS top-ups are paid in the app through our payment partner Razorpay, by UPI, card or other methods shown. We do not see or store your card details.
- You receive a tax invoice or receipt for every payment. Keep the email address saved in the app correct.

# 5. Wallet and SMS balance
- The wallet is used only to pay the per-order fee of the Partner plan. The fee for an order is taken when the order is completed. Your wallet may go below zero by a small amount (about Rs 100), which is taken from your next top-up. When the balance is empty, new orders pause until you top up. Orders in progress and refunds to customers always continue.
- SMS messages (such as login codes and order alerts) are paid from your SMS balance. You top it up in the app.
- A wallet or SMS balance cannot be withdrawn, transferred or exchanged for money. If a top-up is paid but the balance is not added, we add it or refund it to the original payment method within 5 to 7 working days.

# 6. No refunds
- All payments to the Operator are non-refundable. This includes plan fees, prepaid months, extra shops, wallet top-ups, per-order fees, SMS top-ups and the setup fee.
- You can stop using the service at any time. The time you have already paid for stays available until it ends. Nothing is refunded for the unused part, and no cash is paid for a leftover wallet or SMS balance.
- If you move to a lower plan, it starts after your paid time ends.
- The only exceptions are a payment taken twice or by mistake, and a payment taken but not credited. Write to us and the extra amount is returned to the original payment method within 5 to 7 working days. We cannot refund to a different account.

# 7. Your shop and your customers
- You are responsible for your menu, prices, taxes, food safety (including your FSSAI licence), delivery and refunds to your customers.
- Payments from customers go to your own payment account (or cash on delivery). The platform does not hold them.
- Customers' details are given to you only to deliver their orders. Do not use them for anything else and do not share them.
- Be honest about prices and availability, and treat customers and riders with respect.

# 8. Riders, kitchen staff and waiters
You are responsible for the riders, kitchen staff and waiters you add to your shop and for what you agree with them. They are not employees of the platform.

# 9. Your data
Your shop's data stays on the platform's servers. You can see your orders, customers and reports in the app. We use it to run and improve the service and to send you invoices and reports. We do not sell it.

# 10. Stopping
You can stop using the service at any time after paying what is due. We can suspend or end your shop if you break these terms, do not pay, or use the platform for anything unlawful.

# 11. Our responsibility
We work to keep the service running, but cannot promise it will never be down. We are not liable for lost sales caused by outages beyond our control. Our total liability is limited to the plan fees you paid in the last 3 months, except where the law does not allow this.

# 12. Changes
We may change these terms or the fees. The latest version is always in the app and on our website. Using the app after a change means you accept it.

# 13. Contact us
${CONTACT}`,
    },

    owner_privacy: {
        audience: 'owner',
        title: 'Privacy Policy for Shop Owners',
        body: `# Privacy Policy for Shop Owners
Effective {{effectiveDate}}. This explains what we collect about you and your shop, and why. By using the app as a shop owner you accept this policy.

# Who we are
{{platformName}} is a product of {{operatorName}}, which looks after your data. The technology is provided by an independent developer who works on the servers only to run and repair the service.

# What we collect
- Your name, phone number and email.
- Your shop's details: name, address, GST and FSSAI numbers, menu, prices, pictures and settings.
- Your orders, customers' order details, payments, bills, SMS balance and reports.
- Payment records for your plan, wallet and SMS top-ups (the payment status and reference, never your card number).
- The people you add: riders, kitchen staff and waiters (name, phone, work records).
- Your phone's notification address and basic details such as the app version.

# Why we use it
To run your shop on the app: take and deliver orders, send OTPs and alerts, raise invoices and receipts, take your plan, wallet and SMS payments, show you reports, give you support and prevent misuse. We do not sell your data and we do not show ads from other companies.

# Your customers' data
Customers' names, phones and addresses are shown to you only so you can serve their orders. Do not use them for anything else and do not share them.

# Who can see it
- Your customers see your shop's name, menu and prices.
- Your riders, kitchen staff and waiters see what they need for their work.
- Companies that send SMS and notifications, take payments (Razorpay) and host our servers, only to do that work.
- Authorities, if the law requires.

# How long we keep it
Bills, payments and records are kept as long as the law requires. Other data is kept while your shop is on the platform.

# Your choices
You can change your details in the app. To ask about your data, contact us below.

# Safety
Your data is kept on secured servers and sent over encrypted connections. If we find a leak that affects you, we will tell you.

# Contact
${CONTACT}

# Changes
We may change this policy. The latest version is always in the app and on our website.`,
    },
};

module.exports = { DOCS, EFFECTIVE_DATE };
