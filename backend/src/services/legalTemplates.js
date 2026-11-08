// The terms and privacy policies of riders and kitchen staff, and About Us (the customer and owner ones are in legalTemplatesMain.js). Written here, shown as they are.
// NOT legal advice: have a lawyer read them before real use.
//   {{name}}   is filled in when the page is read (the operator, the platform name ...). Words in [square brackets] are blanks: save the operator in Platform business.
//   # heading    - bullet    1. numbered line    anything else is a paragraph
const DOCS = {


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

// the customer and owner terms and privacy policies, and the effective date, are in legalTemplatesMain.js
const main = require('./legalTemplatesMain');
Object.assign(DOCS, main.DOCS);

module.exports = { DOCS, EFFECTIVE_DATE: main.EFFECTIVE_DATE };
