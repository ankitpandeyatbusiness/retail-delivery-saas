// The first draft of every legal document. The supreme admin edits them in the admin app and presses "Send new version".
// NOT legal advice: have a lawyer read them before real use.
//   {{name}}   is filled in when a version is sent (the operator, the platform name, the web address ...). Words in [square brackets]
//              are blanks that must be filled in before the document can be sent.
//   # heading    - bullet    1. numbered line    anything else is a paragraph
const DOCS = {
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
Changing prices, bills, fees, waivers, payment accounts, SMS prices and wallets, the monthly shop money record, company details, agreements and who brought which shop. If you need one of these changed, ask the supreme administrator.

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
A customer ordering app for your shop, an owner panel (orders, menu, riders, money, reports), a rider app, and notifications by app, SMS and email. If you want, you can also give your kitchen staff and waiters their own panels.

# 3. Free period, rent and bills
- Your shop may start with a free period. When it ends, a monthly rent applies, worked out from your delivered orders as shown in the app (Money, Monthly bill).
- Bills are sent to the email you saved and are shown in the app. A bill must be paid by its due date. If it stays unpaid after the grace period, your shop can be paused until it is paid. Orders in progress can still be finished.
- GST is added when the Operator has a GST registration. A shop with a GST number can use the bill for input credit.
- A one-time setup fee applies when your shop joins. It is non-refundable and is charged outside the app.

# 4. SMS balance
- SMS messages (such as login codes and order alerts) are paid from your SMS balance. You top it up in the app. GST is added on top of the amount you choose, when it applies.
- An SMS balance is non-refundable and cannot be withdrawn. It can only be used to send SMS.

# 5. Your shop and your customers
- You are responsible for your menu, prices, taxes, food safety (including your FSSAI licence), delivery and refunds to your customers.
- Payments from customers go to your own payment account (or cash on delivery). The platform does not hold them.
- Customers' details are given to you only to deliver their orders. Do not use them for anything else and do not share them.
- Be honest about prices and availability, and treat customers and riders with respect.

# 6. Riders, kitchen staff and waiters
You are responsible for the riders, kitchen staff and waiters you add to your shop and for what you agree with them. They are not employees of the platform.

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

    rider_privacy: {
        audience: 'customer',
        title: 'Privacy Policy for Riders',
        body: `# Privacy Policy for Riders
Effective {{effectiveDate}}. This explains what we collect and why.

# Who we are
{{platformName}} is a product of {{operatorName}}, which looks after your data. The technology is provided by an independent developer who works on the servers only to run and repair the service.

# What we collect
- Your name and phone number.
- Your deliveries, earnings and cash records.
- Your location while you have an order.
- Your phone's notification address and basic details such as the app version.

# Why we use it
To run the service: sign you in, give you orders, show your location to the shop and the customer during a delivery, and work out your earnings and cash. We do not sell your data and we do not show ads from other companies.

# Who can see it
- The shop you work for sees your name, phone, deliveries and cash records.
- The customer sees your name, phone and location while you deliver their order.
- Companies that send SMS and notifications and host our servers, only to do that work.
- Authorities, if the law requires.

# How long we keep it
Delivery and payment records are kept as long as the law requires. Other data is kept while you work on the platform.

# Safety
Your data is kept on secured servers and sent over encrypted connections. If we find a leak that affects you, we will tell you.

# Contact
{{supportLine}}

We may change this policy at any time without informing you. The latest version is always here.`,
    },

    staff_terms: {
        audience: 'customer',
        title: 'Terms of Service for Kitchen Staff and Waiters',
        body: `# Terms of Service for Kitchen Staff and Waiters
Effective {{effectiveDate}}. These terms are for kitchen staff and waiters who use {{platformName}}.

# 1. Who you work for
You work for the shop that added you in the app. The shop decides your work and what it pays you. {{platformName}} is the software that connects the shop, the customer and you. You are not an employee of the platform.

# 2. How it works
- Kitchen staff see the orders to prepare and mark them ready.
- Waiters take and serve table orders.
- Follow the shop's instructions while you work.

# 3. Your conduct
- Be polite to customers and to the shop. Handle the food with care.
- Do not use the app for anything unlawful, and do not share your login or OTP with anyone.

# 4. Your data
Your name, phone and work record are used to run the service and are shown to the shop that added you. We do not sell your data.

# 5. Stopping
The shop or the platform can remove you from the app. You can stop at any time after finishing the work you have taken.

# 6. Changes
These terms may change. The current version is always in the app, under About Us. By working in the app you accept them.`,
    },

    staff_privacy: {
        audience: 'customer',
        title: 'Privacy Policy for Kitchen Staff and Waiters',
        body: `# Privacy Policy for Kitchen Staff and Waiters
Effective {{effectiveDate}}. This explains what we collect and why.

# Who we are
{{platformName}} is a product of {{operatorName}}, which looks after your data. The technology is provided by an independent developer who works on the servers only to run and repair the service.

# What we collect
- Your name and phone number.
- Your work record: orders, shifts and leave.
- Your phone's notification address and basic details such as the app version.

# Why we use it
To run the service: sign you in, show you the orders you work on, and let the shop see your work. We do not sell your data and we do not show ads from other companies.

# Who can see it
- The shop you work for sees your name, phone and work record.
- Companies that send SMS and notifications and host our servers, only to do that work.
- Authorities, if the law requires.

# How long we keep it
Work and payment records are kept as long as the law requires. Other data is kept while you work on the platform.

# Safety
Your data is kept on secured servers and sent over encrypted connections. If we find a leak that affects you, we will tell you.

# Contact
{{supportLine}}

We may change this policy at any time without informing you. The latest version is always here.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    customer_terms: {
        audience: 'customer',
        title: 'Terms of Service',
        body: `# Terms of Service
Effective {{effectiveDate}}. These terms apply when you use this app to order from a shop.

# 1. Who we are
{{platformName}} is a product of {{operatorName}}, which runs the business and looks after billing and compliance. The technology is provided by an independent developer.

# 2. The shop and your order
This app lets you order from {{shopName}}. The food, its price, its taxes and its delivery are the responsibility of {{shopName}}. We only provide the app that connects you with the shop. The total is shown before you place an order.

# 3. Your account
You sign in with your mobile number and an OTP. Keep the OTP to yourself. You can change your details or delete your account any time in your profile.

# 4. Payment
You can pay cash on delivery or online, depending on what the shop offers. If an order is cancelled after you paid online, the shop refunds you.

# 5. Delivery
Please give a correct address and phone number and be available to receive the order. A delivery PIN may be asked at the door.

# 6. Problems with an order
Use the complaint option in the app. The shop decides on any refund and replies in the app.

# 7. Fair use
Please do not misuse the app or give false information.

# 8. Contact
{{supportLine}}

We may change these terms at any time without informing you. The latest version is always in the app.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    privacy: {
        audience: 'customer',
        title: 'Privacy Policy',
        body: `# Privacy Policy
Effective {{effectiveDate}}. This explains what we collect and why.

# Who we are
{{platformName}} is a product of {{operatorName}}, which looks after your data. The technology is provided by an independent developer who works on the servers only to run and repair the service. This app lets you order from {{shopName}}.

# What we collect
- Your mobile number, and your name and email if you give them.
- Your delivery addresses and, if you allow it, your location to find your address.
- Your orders, payment status, ratings, complaints and messages.
- Your phone's notification address and basic details such as the app version.
- Riders: name, phone, deliveries and, while you have an order, your location.
- Shop owners: business details and billing records.

# Why we use it
To run the service: sign you in, take and deliver orders, take payments, send OTPs and order updates, and give shops their reports. We do not sell your data and we do not show ads from other companies.

# Who can see it
- When you order from {{shopName}}, that shop sees your name, phone, address and orders.
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
{{supportLine}}

We may change this policy at any time without informing you. The latest version is always here.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    owner_privacy: {
        audience: 'owner',
        title: 'Privacy Policy for Shop Owners',
        body: `# Privacy Policy for Shop Owners
Effective {{effectiveDate}}. This explains what we collect about you and your shop, and why.

# Who we are
{{platformName}} is a product of {{operatorName}}, which looks after your data. The technology is provided by an independent developer who works on the servers only to run and repair the service.

# What we collect
- Your name, phone number and email.
- Your shop's details: name, address, GST and FSSAI numbers, menu, prices, pictures and settings.
- Your orders, customers' order details, payments, bills, SMS balance and reports.
- The people you add: riders, kitchen staff and waiters (name, phone, work records).
- Your phone's notification address and basic details such as the app version.

# Why we use it
To run your shop on the app: take and deliver orders, send OTPs and alerts, raise bills and receipts, show you reports, give you support and prevent misuse. We do not sell your data and we do not show ads from other companies.

# Your customers' data
Customers' names, phones and addresses are shown to you only so you can serve their orders. Do not use them for anything else and do not share them.

# Who can see it
- Your customers see your shop's name, menu and prices.
- Your riders, kitchen staff and waiters see what they need for their work.
- Companies that send SMS and notifications, take payments and host our servers, only to do that work.
- Authorities, if the law requires.

# How long we keep it
Bills, payments and records are kept as long as the law requires. Other data is kept while your shop is on the platform.

# Your choices
You can change your details in the app. To ask about your data, contact us below.

# Safety
Your data is kept on secured servers and sent over encrypted connections. If we find a leak that affects you, we will tell you.

# Contact
{{supportLine}}

We may change this policy at any time. When we do, we will tell you in the app and by email, and you will be asked to agree to the new version.

By pressing "Agree" you confirm that you have read this policy and agree to it. Your agreement is saved with the date, the time and the version.`,
    },

    /* --------------------------------------------------------------------------------------------------------------- */
    about_us: {
        audience: 'customer',
        title: 'About Us',
        body: `# About {{platformName}}
{{platformName}} helps restaurants and shops take orders and deliver them, all in one place.

# For customers
- Order from your favourite shop in a few taps.
- Pay cash on delivery or online.
- Follow your order and your rider on the map.
- Tell the shop if something is wrong, right in the app.

# For shops
- Your own ordering app for your customers.
- An owner panel for orders, menu, riders, money and reports.
- A rider app, and panels for your kitchen staff and waiters if you want them.
- Alerts by app, SMS and email.

# Who runs it
{{platformName}} is a product of {{operatorName}}, which runs the business and looks after billing and compliance. The technology is provided by an independent developer.

# Contact
{{supportLine}}`,
    },
};

module.exports = { DOCS };
