// Routes under /api/admin that the app deliberately does NOT call. Each needs a reason a person can check.
// match: a RegExp tested against "METHOD /api/admin/path" with every parameter written as :p
const SHOP = '\\/api\\/admin\\/tenants\\/:p\\/shop';
module.exports = [
    // -- not part of the phone app by design --
    { match: /^POST \/api\/admin\/auth\/login$/, why: 'Password login is switched off by default; the app logs in with phone OTP only.' },
    { match: /^(GET|POST|PUT|PATCH|DELETE|ALL) \/api\/admin\/tenants\/:p\/riders\/:p(\/|$)/, why: 'Decision: a superadmin never acts as a rider. Riders are managed through the shop riders screens.' },

    // -- the same handlers, reached through the other mount of the same router --
    { match: /^(GET|POST|PUT|PATCH|DELETE) \/api\/admin\/tenants\/:p\/(categories|products|collections|banners|coupons)(\/|$)/, why: 'Same handlers as /tenants/:tid/shop/<resource>, which the app uses (that mount also has category timings and stock).' },
    { match: /^PUT \/api\/admin\/tenants\/:p\/shop\/(categories|products|collections|banners|coupons)\/:p$/, why: 'PUT and PATCH run the same code; the app sends PATCH.' },

    // -- the owner's version of something the app does through an admin route (all shops, same rules) --
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/orders(\/:p)?$/, why: 'The app lists and opens orders through /api/admin/orders (same data, with the shop name, across shops).' },
    { match: /^PATCH \/api\/admin\/tenants\/:p\/shop\/orders\/:p\/status$/, why: 'The app changes status through /api/admin/orders/:id/status, which has the superadmin rules (cancel reasons, force delivered).' },
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/orders\/:p\/invoice$/, why: 'The app downloads the invoice through /api/admin/orders/:id/invoice.' },
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/live$/, why: 'The app uses /api/admin/tenants/:tid/live (the same snapshot, without owner-only lines).' },
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/reports\/sales$/, why: 'The app uses /api/admin/reports/sales?tenantId=...' },
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/payments\/disputes$/, why: 'The app uses /api/admin/tenants/:tid/disputes, which also has the evidence notes.' },
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/payments\/transactions$/, why: 'The app uses /api/admin/tenants/:tid/ledger (same ledger, plus the CSV export).' },
    { match: /^GET \/api\/admin\/tenants\/:p\/shop\/subscription\/invoices(\/:p\/pdf)?$/, why: 'The app uses /api/admin/subscriptions/invoices (all shops, with every action).' },
    { match: /^(GET|PATCH) \/api\/admin\/tenants\/:p\/shop\/customers(\/:p)?$/, why: 'The app reaches the same people through /api/admin/tenants/:tid/users (phones masked, revealing one is audited).' },
    { match: /^PUT \/api\/admin\/tenants\/:p\/shop\/accepting-orders$/, why: 'Same setting as Orders and fees > Accepting orders (settings.orders.acceptingOrders).' },
    { match: /^PUT \/api\/admin\/tenants\/:p\/shop\/settings$/, why: 'The owner shortcut for fields the app edits through PUT /api/admin/tenants/:tid (hours, riders, COD limit, notifications, phone, address, delivery).' },

    // -- things only the shop owner does, about his own inbox, pop-ups or payments --
    { match: /^(GET|POST) \/api\/admin\/tenants\/:p\/shop\/notifications(\/.*)?$/, why: "The owner's own inbox: marking it read would change what the owner sees. The platform has its own inbox." },
    { match: /^(GET|POST) \/api\/admin\/tenants\/:p\/shop\/billing\/prompts(\/choice)?$/, why: 'Pop-up reminders for the owner. Only the owner can answer them (the server refuses a superadmin).' },
    { match: /^POST \/api\/admin\/tenants\/:p\/shop\/subscription\/invoices\/:p\/pay$/, why: 'The owner pays a bill online with a QR. The superadmin marks a bill paid by hand (Invoice > Mark as paid).' },
    { match: /^(GET|POST) \/api\/admin\/tenants\/:p\/shop\/sms\/topup(\/options)?$/, why: 'The owner buys SMS credit with a payment QR. The superadmin adds credit directly or marks a top-up paid.' },
];
