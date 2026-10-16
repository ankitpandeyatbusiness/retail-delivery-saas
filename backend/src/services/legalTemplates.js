// The first draft of every legal document. The supreme admin edits them in the admin app and presses "Send new version".
// NOT legal advice: have a lawyer read them before real use.
//   {{name}}   is filled in when a version is sent (the operator, the platform name, the web address ...). Words in [square brackets]
//              are blanks that must be filled in before the document can be sent.
//   # heading    - bullet    1. numbered line    anything else is a paragraph
const DOCS = {
    /* --------------------------------------------------------------------------------------------------------------- */
    operator_agreement: {
        audience: 'partner',
        title: 'Our arrangement for running the platform',
        body: `# Our arrangement for running the platform
Between {{ownerName}} (the platform owner) and {{partnerName}}, for {{operatorName}} (the operator).
Date: [DD Month YYYY]. Length: 12 months, until [DD Month YYYY].

This note is written so that both of us know exactly how this works. The signed paper agreement is made separately and follows these points.

# 1. What this is
- {{ownerName}} owns a software platform for restaurants and shops: a customer app, a shop owner panel, a rider app and an admin app.
- {{ownerName}} does not yet have a registered business, a GST number or a payment-gateway account of his own for it.
- For 12 months, {{operatorName}} is the operator: its name and GST number appear on the invoices and its payment-gateway account receives the shops' payments.
- We share the money as described below. At the end, {{ownerName}} moves the platform to his own business.

# 2. Who owns what
1. {{ownerName}} owns the platform: the app, the source code, the servers, the database, the storage, the backups, the domain and the brand name. All of these stay in his accounts.
2. {{partnerName}} may act as the operator for these 12 months only. He does not get the source code or ownership of anything.
3. The platform's name is {{platformName}}. {{ownerName}} can change it.

# 3. What the operator does
1. Keeps the GST registration, business registration and payment-gateway account valid.
2. Lets the platform issue invoices in the operator's name and collect the shops' payments into his account.
3. Pays the GST and files the GST returns on every invoice issued in his name.
4. Registers the SMS (DLT) account in his business name and pays its registration fee.
5. Does not change keys, fees, invoice settings or any other money setting in the platform. Only {{ownerName}} does that.
6. Shows {{ownerName}} the payment-gateway settlement statement once a month.
7. Does not keep back or divert any money that belongs to {{ownerName}}.

# 4. What the platform owner does
1. Builds, hosts, maintains and supports the platform, including servers, database and backups.
2. Keeps the Common Sheet (section 7) correct and open for {{partnerName}} to see at all times.
3. Keeps the shops' data safe and uses it only to run the platform.

# 5. How the money is shared
The share is worked out on the amount before GST. GST is not income for either of us.
- A shop that {{partnerName}} brought: {{ownerName}} gets {{ownerPctPartnerBrought}}% and {{partnerName}} gets {{partnerPctPartnerBrought}}%.
- A shop that {{ownerName}} brought: {{ownerName}} gets {{ownerPctOwnerBrought}}% and {{partnerName}} gets {{partnerPctOwnerBrought}}%.
- This is the same for the monthly rent, the one-time setup fee and the SMS balance the shop buys.
- Who brought the shop is recorded in the platform when the shop is created. That record is final unless both of us agree to change it.
- A payment counts on the day the payment gateway captures it.
- If a payment is refunded or cancelled, both shares for it are reversed. A fee that is waived or reduced is shared only on what is received. {{ownerName}} approves every waiver.
- Payment-gateway and bank charges: [who bears them].

# 6. Shared costs: always {{costOwnerPct}} / {{costPartnerPct}}
These costs are split equally, whoever brought the shop: the SMS provider recharge, server, database, storage and backup charges, API and software-service charges, and other running costs we both agree on in writing.
One of us pays the whole cost and gets the other's share back later. Every cost is entered on the Common Sheet with the date, who paid and the bill. A single cost above Rs. [amount] needs the other's approval first, except the SMS recharge. DLT registration fees and our own taxes are not shared costs.

# 7. The Common Sheet
- The platform keeps a sheet that adds a row by itself every time a shop pays, and shows who owes whom, the due date and whether it is pending, partly paid or paid.
- The sheet only holds numbers. The real money moves between us outside the platform.
- Only {{ownerName}} can change the sheet. {{partnerName}} can see it and download it at any time, and can add an "I have paid" note, which {{ownerName}} confirms.
- Every change is saved with the date, the time and who made it. Nothing is deleted. A mistake is fixed by a new, visible entry.
- If {{partnerName}} thinks a row is wrong, he tells {{ownerName}} within [15] days. After that the row is taken as accepted.

# 8. When the operator pays
1. {{partnerName}} pays {{ownerName}} his share of each payment within {{payDays}} days of the day it counts. After that it shows as late on the sheet.
2. Payment is by bank transfer or UPI to the account {{ownerName}} gives, with the sheet reference in the note.
3. What one owes can be set against what the other owes. {{ownerName}} records it on the sheet with the amount and a reason.
4. If a shop pays rent in cash or by bank transfer, the platform records who received it. If {{ownerName}} receives it, he settles {{partnerName}}'s share with him in the same way.
5. If a payment is more than [30] days late, {{ownerName}} can end the arrangement early and move the platform.

# 9. Taxes
- {{partnerName}} pays and files the GST on invoices in his name.
- Each of us pays income tax on his own earnings.
- We will each ask our own tax adviser whether TDS applies to the payments between us, and whether an invoice is needed for a share, and do what they advise.

# 10. At the end of the 12 months
1. {{ownerName}} moves the platform to his own business by changing the business details, the gateway keys and the invoice series in the admin app.
2. From that day the shops pay {{ownerName}}'s business and {{partnerName}} has no share of those payments, unless we sign an extension.
3. Invoices issued before that day stay in the operator's name. If a shop pays one of them later, it is shared as in section 5.
4. Within [15] days we close the sheet and both confirm the final statement by email. What is owed is paid within [30] days after that.
5. The unused SMS balances that shops still have are honoured by {{ownerName}}'s business. {{partnerName}} pays the part of those balances that has not yet been shared.
6. {{partnerName}} helps with the move (notices to shops, closing his gateway links to the platform, statements).
7. After the move, {{partnerName}} may still call these shops his past clients, but not say he currently serves them.
8. Extending beyond 12 months needs a written agreement signed by both of us. Nothing is extended automatically.

# 11. Data
All data (shops, customers, riders, orders, payments) stays on {{ownerName}}'s servers. {{partnerName}} may see it only through the admin app, only to run the service. He does not copy, sell or share it, during or after. If either of us finds a leak or misuse, we tell the other within 48 hours.

# 12. Not taking the shops away
During the 12 months and for [12] months after, neither of us will encourage a shop to leave the platform for a competing product.

# 13. Ending early
- Either of us can end it with [30] days' notice.
- {{ownerName}} can end it at once and move the platform if {{partnerName}} is more than [30] days late with a payment, changes money settings without permission, loses his GST or gateway account, or breaks sections 11 or 12.
- {{partnerName}} can end it if {{ownerName}} has not paid a shared cost for more than [30] days after a written reminder.
- When it ends early, section 10 applies from that day. Money already earned stays due.

# 14. Keeping it private
We keep each other's business details, this note and the sheet private for [3] years after the end.

# 15. Each of us is separate
We are two separate businesses. This is not a partnership, and neither of us can bind the other to a contract or a debt. Each of us is responsible for his own taxes and actions.

# 16. If we disagree
We first talk to each other and try to settle it within [15] days. If we cannot, we settle it as the signed paper agreement says.

# 17. Changing this note
Any change must be in writing and confirmed by both of us. An email from each is enough.

When you press "Agree" you confirm that you have read this note and agree to it. The platform saves who agreed, the version and the time as an extra record. The signed paper agreement is the main document.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    team_terms: {
        audience: 'team',
        title: 'Terms for administrators',
        body: `# Terms for administrators of {{platformName}}
These terms apply to everyone who has an administrator login for the platform.

# 1. Who runs the platform
The platform is owned by {{ownerName}}. For the time being it is operated by {{operatorName}}. The operator can change; you will be told.

# 2. What you may do
- Use the admin app only for the work you were given.
- Look at data of shops, customers, riders and orders only when your work needs it.
- Everything you change is recorded with your name and the time.

# 3. What only the supreme administrator may do
Changing prices, bills, fees, waivers, payment accounts, SMS prices and wallets, the settlement sheet, company details, agreements and who brought which shop. If you need one of these changed, ask the supreme administrator.

# 4. Keep it private
- Do not share your login or the OTP sent to your phone with anyone.
- Do not copy, sell or share data from the platform. Keep what you learn about the shops and the platform private, during and after your work.
- Tell the supreme administrator at once if you lose your phone or think someone else used your login.

# 5. Customers' and riders' data
Personal data (names, phones, addresses, orders) is handled under India's data protection law. Use it only to run the service.

# 6. Stopping
Your access can be switched off at any time. When it ends, you do not keep or use any data or documents from the platform.

# 7. Changes
These terms may change. You will be asked to agree to a new version the next time you open the app.

By pressing "Agree" you confirm that you have read these terms and agree to them. Your agreement is saved with the date, the time and the version.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    owner_terms: {
        audience: 'owner',
        title: 'Terms of Service for shop owners',
        body: `# Terms of Service for shop owners
Effective {{effectiveDate}}. These terms are between you (the shop) and the operator of {{platformName}}.

# 1. Who provides the service
- The platform {{platformName}} is owned by {{ownerName}}.
- The service is provided to you by {{operatorName}}, {{operatorAddress}}{{operatorGstin}}. This is the "Operator". Bills and receipts come in the Operator's name.
- The Operator can change. If it does, you will get a notice in the app and by email, and you will be asked to agree to the updated terms. The platform owner can make this change on the Operator's behalf.

# 2. What you get
A customer ordering app for your shop, an owner panel (orders, menu, riders, money, reports), a rider app, and notifications by app, SMS and email.

# 3. Free period, rent and bills
- Your shop may start with a free period. When it ends, a monthly rent applies, worked out from your delivered orders as shown in the app (Money, Monthly bill).
- Bills are sent to the email you saved and are shown in the app. A bill must be paid by its due date. If it stays unpaid after the grace period, your shop can be paused until it is paid. Orders in progress can still be finished.
- GST is added when the Operator has a GST registration. A shop with a GST number can use the bill for input credit.
- Setup fees and other charges are shown before you pay them.

# 4. SMS balance
- SMS messages (such as login codes and order alerts) are paid from your SMS balance. You top it up in the app. GST is added on top of the amount you choose, when it applies.
- A top-up is used up as SMS are sent. A balance that you have not used is not refunded except where the law says so or the Operator agrees.

# 5. Your shop and your customers
- You are responsible for your menu, prices, taxes, food safety (including your FSSAI licence), delivery and refunds to your customers.
- Payments from customers go to your own payment account (or cash on delivery). The platform does not hold them.
- Customers' details are given to you only to deliver their orders. Do not use them for anything else and do not share them.
- Be honest about prices and availability, and treat customers and riders with respect.

# 6. Riders
You are responsible for the riders you add to your shop and for what you agree with them. Riders are not employees of the platform.

# 7. Your data
Your shop's data stays on the platform's servers. You can see your orders, customers and reports in the app. We use it to run and improve the service and to send you bills and reports. We do not sell it.

# 8. Stopping
You can stop using the service at any time after paying what is due. We can suspend or end your shop if you break these terms, do not pay, or use the platform for anything unlawful.

# 9. Our responsibility
We work to keep the service running, but cannot promise it will never be down. We are not liable for lost sales caused by outages beyond our control. Our total liability is limited to the rent you paid in the last 3 months, except where the law does not allow this.

# 10. Changes
We may change these terms or the fees. We will tell you in the app and by email, and you will be asked to agree to the new version the next time you open the app.

# 11. Contact
{{supportLine}}

By pressing "Agree" you confirm that you are the owner (or authorised by the owner) of the shop and agree to these terms. Your agreement is saved with the date, the time and the version.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    rider_terms: {
        audience: 'rider',
        title: 'Terms for delivery riders',
        body: `# Terms for delivery riders
Effective {{effectiveDate}}. These terms are for riders who deliver orders through {{platformName}}.

# 1. Who you work for
You deliver for the shop that added you in the app. The shop decides what it pays you. {{platformName}} is the software that connects the shop, the customer and you. You are not an employee of the platform.

# 2. How it works
- You get an offer for an order. You can accept or reject it.
- After you pick up the order, you deliver it to the customer, ask for the delivery PIN when the shop uses one, and collect cash if the order is cash on delivery.
- Cash you collect belongs to the shop. Hand it over as the shop tells you; the app keeps a record of what you owe.

# 3. Your location
While you have an order, the app shares your location with the shop and the customer so they can see where you are. Keep the app open while you deliver. We do not use your location for anything else.

# 4. Your conduct
- Deliver safely and follow the traffic rules.
- Be polite to customers and to the shop. Handle the food with care.
- Do not use the app for anything unlawful, and do not share your login or OTP with anyone.

# 5. Your data
Your name, phone and delivery record are used to run the service and are shown to the shop that added you. We do not sell your data.

# 6. Stopping
The shop or the platform can remove you from the app. You can stop at any time after finishing the orders you accepted and handing over any cash you hold.

# 7. Changes
These terms may change. You will be asked to agree to a new version the next time you open the app.

By pressing "Agree" you confirm that you have read these terms and agree to them. Your agreement is saved with the date, the time and the version.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    customer_terms: {
        audience: 'customer',
        title: 'Terms of Service',
        body: `# Terms of Service
Effective {{effectiveDate}}. These terms apply when you use this app to order from a shop.

# 1. Who is who
- The app is built by {{ownerName}} on the {{platformName}} platform and operated by {{operatorName}}.
- The food and the delivery are provided by the shop you order from. The shop is responsible for the food, its price, its taxes and its delivery.

# 2. Your account
You sign in with your mobile number and an OTP. Keep the OTP private. You can change your name and email in your profile and delete your account any time from the profile screen.

# 3. Orders and payment
- Prices and availability are set by the shop. The total, including taxes and charges, is shown before you place an order.
- You can pay by the methods the shop offers: cash on delivery or online. Online payments are processed by a payment gateway.
- A shop can cancel an order that it cannot deliver. If you paid online, the shop refunds you.
- Cash on delivery can be limited or stopped for a number if earlier cash orders were not accepted.

# 4. Delivery
Give a correct address and phone number and be reachable. A delivery PIN may be asked at the door.

# 5. Complaints and refunds
If something is wrong with an order, use the complaint option in the app. The shop decides on the refund and replies in the app.

# 6. Messages and offers
We send you messages about your orders. The shop may also send you offers by notification. You can turn offers off in your profile.

# 7. Using the app properly
Do not misuse the app, give false information or try to break it.

# 8. Changes and contact
We may change these terms. The current version is always in the app. {{supportLine}}`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    privacy: {
        audience: 'customer',
        title: 'Privacy Policy',
        body: `# Privacy Policy
Effective {{effectiveDate}}. This explains what we collect and how we use it.

# Who we are
The {{platformName}} platform is owned by {{ownerName}} and operated by {{operatorName}}. The shop you order from also receives the details needed to serve you.

# What we collect
- Your mobile number, and your name and email if you give them.
- Your delivery addresses and, if you allow it, your location to find your address.
- Your orders, payments status, ratings, complaints and messages.
- Your phone's push address to send notifications, and basic technical details such as the app version.
- Riders: your name, phone, deliveries and, while you have an order, your location.
- Shop owners: your business details and billing records.

# Why we use it
To run the service: sign you in, take and deliver orders, take payments, send OTPs, order updates and bills, prevent misuse, and give the shop its reports. We do not sell your data and we do not show advertising from other companies.

# Who sees it
- The shop you order from sees your name, phone, address and orders.
- The rider sees your name, phone, address and the order.
- Our service providers who send SMS, email and notifications, take payments and host the servers, only for those purposes.
- Authorities, if the law requires.

# How long we keep it
Orders and bills are kept as long as the law requires for accounts and tax. Other data is kept while your account is open. When you delete your account, your profile, addresses, favourites and logins are deleted. The shop keeps its past orders (with your name and phone hidden) because it needs them for its accounts.

# Your choices
You can change your details, turn offers off, and delete your account in the profile screen. To ask us anything about your data, contact us below.

# Safety
Data is kept on secured servers and sent over encrypted connections. No system is perfectly safe, and if we find a leak that affects you we will tell you.

# Children
The app is not meant for children under 18 to use without a parent.

# Changes and contact
We may update this policy; the current one is always here. {{supportLine}}`,
    },
};

module.exports = { DOCS };
