// The first draft of every legal document. The supreme admin edits them in the admin app and presses "Send new version".
// NOT legal advice: have a lawyer read them before real use.
//   {{name}}   is filled in when a version is sent (the operator, the platform name, the web address ...). Words in [square brackets]
//              are blanks that must be filled in before the document can be sent.
//   # heading    - bullet    1. numbered line    anything else is a paragraph
const DOCS = {
    /* --------------------------------------------------------------------------------------------------------------- */
    operator_agreement: {
        audience: 'partner',
        title: 'Software licence and revenue-sharing agreement',
        body: `# Software licence and revenue-sharing agreement
Between {{ownerName}} (the "Developer") and {{partnerName}} (the "Agency"), for the {{platformName}} platform.
Date: [DD Month YYYY].

This note sets out how we work together. The signed paper agreement follows these points. It is not legal advice; both sides should have it checked.

# 1. Brand, business and ownership
1. The Agency owns the {{platformName}} domain, the client relationships, the customer database and the business. To the public the platform is a product of the Agency.
2. The Developer wrote the software and keeps the copyright in the core code and its architecture.
3. The Developer gives the Agency a permanent licence to deploy, run and earn from the software under the {{platformName}} name. [Exclusive or non-exclusive; may the Agency let others use it? State here.]
4. The Developer may reuse the base code for other projects, including ones outside {{platformName}}. The Developer may not use the Agency's customer database or client list for them.

# 2. Who does what
1. Developer: builds and updates the software, fixes faults, keeps the servers and database running.
2. Agency: collects all rent and SMS top-up payments through its own payment-gateway account, issues the invoices, pays the GST and income tax, and meets every legal duty of the business.

# 3. Net profit and costs
1. Net profit is the money received minus GST and other taxes, minus the shared running costs.
2. Shared running costs: servers, database, DLT registration, SMS credits and other costs both sides agree in writing. They come off the money received before any profit is shared.
3. If the money received does not cover the costs, the Agency pays the shortfall from its own pocket. The Developer carries no upfront cost. The Agency may take back what it paid out of later money received, before profit is shared.

# 4. Sharing net profit
- A shop the Agency brought: {{partnerPctPartnerBrought}}% to the Agency and {{ownerPctPartnerBrought}}% to the Developer.
- A shop the Developer brought: {{ownerPctOwnerBrought}}% to the Developer and {{partnerPctOwnerBrought}}% to the Agency (this pays the Agency for payment handling and compliance).
- Who brought a shop is recorded in the platform when the shop is created. It stays that way unless both sides agree to change it.
- The share is worked out on the amount before GST. Refunded or cancelled payments are taken back from both shares.

# 5. The Common Sheet and payment
1. The platform keeps a sheet that adds a row each time a shop pays and shows who owes whom. It holds numbers only; the real money moves outside the platform.
2. The Agency can see and download the sheet at any time. Every change is saved with date, time and name. Nothing is deleted.
3. The Agency pays the Developer his share within {{payDays}} days of each payment, by bank transfer or UPI.
4. The Agency shares its payment-gateway statement every month. The Developer may check the figures. [Audit right, once a year / on notice.]
5. If the Agency thinks a row is wrong it says so within [15] days; after that the row is accepted.
6. Taxes: the Agency pays GST and its own income tax. The Developer pays tax on his own earnings. Both will ask their tax adviser whether GST or TDS applies to the share and royalty payments, and whether an invoice is needed.

# 6. Terms of Service
The public Terms of Service on {{platformName}} will state openly that the Agency is the business and compliance owner and that the technology is provided by an independent developer.

# 7. Duration and ending
1. This agreement has no end date. It continues until either side ends it. [Notice period, e.g. 60 days written notice; reasons that allow ending at once.]
2. The licence in section 1 and the Developer's copyright are not affected by ending.

# 8. Exit
1. A 60-day transition starts on the day of notice. The Developer keeps the platform working during it, then hands over full access to the servers and the code running on them.
2. The Agency keeps the domain, the clients and the right to keep running the software.
3. The Agency pays the Developer a royalty of {{royaltyPct}}% of net profit on all shops, with no end date. Costs are deducted first, as in section 3.
4. After the 60 days the Developer has no duty to maintain, fix or host anything. The Agency looks after its own copy.
5. Within [15] days of the end of the transition both sides confirm a final statement; what is owed is paid within [30] days.
6. The Developer stays free to use the core code for any project, competing or not.

# 9. Data
All data of shops, customers, riders and orders belongs to the Agency. The Developer uses it only to run and fix the platform, does not copy, sell or share it, and tells the Agency within 48 hours of finding a leak. [Data-processing terms to be added.]

# 10. Accounts
Domain, payment-gateway account, SMS (DLT) registration, Google Play and Apple developer accounts: [state who owns each; suggested: all with the Agency except the cloud and code accounts that the Developer runs until the exit].

# 11. Keeping it private
Both sides keep this note, the sheet and each other's business details private for [3] years after the end.

# 12. Each of us is separate
We are two separate parties. This is not a partnership, and neither can bind the other to a contract or a debt.

# 13. If we disagree
We first talk and try to settle it within [15] days. If we cannot, we settle it as the signed paper agreement says.

# 14. Changing this note
Any change must be in writing and confirmed by both sides. An email from each is enough.

When you press "Agree" you confirm that you have read this note and agree to it. The platform saves who agreed, the version and the time as an extra record. The signed paper agreement is the main document.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    team_terms: {
        audience: 'team',
        title: 'Terms for administrators',
        body: `# Terms for administrators of {{platformName}}
These terms apply to everyone who has an administrator login for the platform.

# 1. Who runs the platform
{{platformName}} is a product of {{operatorName}}, which runs the business and handles billing, tax and compliance. The technology is provided by an independent developer.

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
- {{platformName}} is a product of {{operatorName}}, {{operatorAddress}}{{operatorGstin}}. This is the "Operator". It runs the business and is responsible for billing, tax and compliance. Bills and receipts come in the Operator's name and your rent and SMS payments go to the Operator.
- The technology behind the app is provided to the Operator by an independent developer.
- If the Operator's details change, you will get a notice in the app and by email, and you will be asked to agree to the updated terms.

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
        audience: 'customer',
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
These terms may change. The current version is always in the app, under Terms and privacy. By working as a rider you accept them.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    customer_terms: {
        audience: 'customer',
        title: 'Terms of Service',
        body: `# Terms of Service
Effective {{effectiveDate}}. These terms apply when you use this app to order from a shop.

# 1. Who is who
- {{platformName}} is a product of {{operatorName}}, which runs the business and is responsible for billing, tax and compliance. The technology is provided by an independent developer.
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
{{platformName}} is a product of {{operatorName}}, which holds your data and is responsible for it. The technology is provided by an independent developer who works on the servers only to run and repair the service. The shop you order from also receives the details needed to serve you.

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
