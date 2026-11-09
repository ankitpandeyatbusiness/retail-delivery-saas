// One shop's pages, grouped by what you are trying to do (not alphabetical). The shop page shows these six folders; each opens a page with its rows.
// A row: { section, icon, title, subtitle, screen, params? }. params default to { shopId, name }; ServicesShop wants { tenantId, name }.
export const FOLDERS = [
    {
        key: 'running', icon: 'live', section: 'orders', title: 'Running now',
        subtitle: 'Orders, riders, complaints, bookings and reports of today',
        rows: [
            { section: 'orders', icon: 'live', title: 'Live activity', subtitle: 'What is happening in this shop right now', screen: 'ShopLive' },
            { section: 'orders', icon: 'orders', title: 'Orders', subtitle: 'Every order of this shop, with status and rider', screen: 'ShopOrders' },
            { section: 'riders', icon: 'rider', title: 'Riders and cash', subtitle: 'Riders, the cash they hold, how they perform', screen: 'ShopRiders' },
            { section: 'alerts', icon: 'message', title: 'Complaints', subtitle: 'Answer and refund customer complaints', screen: 'ShopComplaints' },
            { section: 'orders', icon: 'message', title: 'Services and booking', subtitle: 'Inquiries and table bookings, to read', screen: 'ServicesShop', byTenantId: true },
            { section: 'orders', icon: 'receipt', title: 'Bulk orders', subtitle: 'Bulk rules and the bulk orders with their money', screen: 'ShopBulk' },
            { section: 'platform', icon: 'megaphone', title: 'Messages to customers', subtitle: 'Tell customers and riders something', screen: 'ShopMessages' },
            { section: 'platform', icon: 'megaphone', title: 'Autopilot', subtitle: 'Reminders this shop sends its customers: what it did, stop it', screen: 'ShopAutopilot' },
            { section: 'money', icon: 'chart', title: 'Progress report', subtitle: 'How the shop is doing: sales, customers, food, riders, tips', screen: 'ShopReport' },
            { section: 'money', icon: 'chart', title: 'Sales report', subtitle: 'Sales per day, items and payments', screen: 'SalesReport' },
        ],
    },
    {
        key: 'money', icon: 'bank', section: 'money', title: 'Money',
        subtitle: 'Plan, online payments, SMS balance, every money movement',
        rows: [
            { section: 'orders', icon: 'wallet', title: 'Online payments', subtitle: 'Razorpay setup, money received, refunds, chargebacks', screen: 'ShopPayments' },
            { section: 'catalog', icon: 'message', title: 'SMS wallet', subtitle: 'Balance, top-ups, prices, own sender', screen: 'ShopSms' },
            { section: 'platform', icon: 'chart', title: 'Transactions', subtitle: 'Every money movement of this shop', screen: 'Ledger' },
        ],
    },
    {
        key: 'menu', icon: 'food', section: 'catalog', title: 'Menu and offers',
        subtitle: 'The dishes, collections, banners, coupons and loyalty points',
        rows: [
            { section: 'catalog', icon: 'food', title: 'Menu', subtitle: 'Items, categories, stock, import from a sheet', screen: 'ShopMenu' },
            { section: 'catalog', icon: 'sparkle', title: 'Collections', subtitle: 'Festival specials and combo deals', screen: 'Collections' },
            { section: 'catalog', icon: 'banner', title: 'Banners', subtitle: 'Offer cards on the home screen', screen: 'Banners' },
            { section: 'money', icon: 'coupon', title: 'Coupons', subtitle: 'Discount codes', screen: 'Coupons' },
            { section: 'catalog', icon: 'coupon', title: 'Points and rewards', subtitle: 'Customer points, rider points and badges', screen: 'SettingsPoints' },
        ],
    },
    {
        key: 'people', icon: 'users', section: 'people', title: 'People',
        subtitle: 'Who runs this shop, its customers and riders',
        rows: [
            { section: 'money', icon: 'key', title: 'Owners', subtitle: 'Who can run this shop', screen: 'ShopOwners' },
            { section: 'people', icon: 'users', title: 'Users', subtitle: 'Customers, riders, cooks, waiters and owners', screen: 'ShopUsers' },
            { section: 'platform', icon: 'bell', title: 'Message the owner', subtitle: "A notice in the owner's app", screen: 'ShopNotify' },
        ],
    },
    {
        key: 'control', icon: 'shield', section: 'alerts', title: 'Shop control',
        subtitle: 'Edit details, close the shop, block or pause it, history',
        rows: [
            { section: 'settings', icon: 'edit', title: 'Edit shop', subtitle: 'Name, contact, address, delivery area, GST', screen: 'ShopEdit' },
            { section: 'alerts', icon: 'lock', title: 'Close this shop', subtitle: 'Stop the shop but keep all its data, with a reason', screen: 'ShopClose', closeRow: true },
            { section: 'catalog', icon: 'star', title: 'Plan', subtitle: 'Partner, Growth or Pro, free days, extra features, website and app switches', screen: 'ShopPlan' },
            { section: 'alerts', icon: 'shield', title: 'Access and maintenance', subtitle: 'Block the owner panel, pause the shop for maintenance', screen: 'ShopAccess' },
            { section: 'settings', icon: 'notes', title: 'Activity log', subtitle: 'Who changed what in this shop', screen: 'ShopActivity' },
            { section: 'catalog', icon: 'palette', title: 'Branding', subtitle: 'Logo, home pictures, colours from logo, app icon', screen: 'ShopBranding' },
            { section: 'platform', icon: 'tool', title: 'Development details', subtitle: 'App id, versions, Razorpay, SMS and DLT, build commands', screen: 'ShopDev' },
        ],
        cards: true,   // this folder also holds who brought the shop and make a brand
    },
];
export const folderOf = (key) => FOLDERS.find((f) => f.key === key);
