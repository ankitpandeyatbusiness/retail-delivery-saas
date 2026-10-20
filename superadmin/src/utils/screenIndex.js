// A map of the whole app for the search box: every screen and the settings found on it, with the words a person
// might type. `scope: 'shop'` entries need a shop (the search asks which one); `stack` says where the screen lives.
//   stack: root (above the tabs) | ShopsTab | MoneyTab | OrdersTab | MoreTab | HomeTab
const E = (title, where, screen, stack, icon, section, keywords, scope = 'app') => ({ title, where, screen, stack, icon, section, keywords, scope });

export const SCREEN_INDEX = [
    /* ---- money ---- */
    E('Profit and loss', 'Money', 'ProfitLoss', 'root', 'chart', 'money', 'profit loss income cost expenses margin month net earnings analysis'),
    E('Who owes you money', 'Money', 'Receivables', 'root', 'warning', 'alerts', 'receivables unpaid overdue pending dues late paying not paying aging defaulters outstanding rent'),
    E('Your expenses', 'Money', 'Expenses', 'root', 'wallet', 'catalog', 'expenses costs hosting server sms provider staff salary marketing tools tax spending add expense'),
    E('Rent invoices', 'Money', 'Invoices', 'MoneyTab', 'receipt', 'money', 'invoices bills rent subscription generate mark paid void waive grace overdue pdf'),
    E('Transactions', 'Money', 'Ledger', 'MoneyTab', 'wallet', 'people', 'transactions ledger money received payments csv export statement history'),
    E('SMS profit', 'Money', 'SmsProfit', 'MoneyTab', 'chart', 'catalog', 'sms profit revenue cost margin per shop'),
    E('SMS prices', 'Money', 'PlatformSms', 'MoneyTab', 'coupon', 'catalog', 'sms prices rate cost packs top up minimum maximum low balance'),
    E('GST on shop bills', 'Money', 'Gst', 'MoneyTab', 'percent', 'money', 'gst tax percent rate global every shop bill invoice inclusive exclusive customer gstin charge'),
    E('Billing rules', 'Money', 'PlatformBilling', 'MoneyTab', 'tune', 'settings', 'billing rules free orders free months due days grace days tiers monthly fee pricing slabs'),
    E('Business details', 'Money', 'PlatformBusiness', 'MoneyTab', 'bank', 'platform', 'business details gst gstin legal name address sac code invoice header logo payment instructions upi bank'),
    E('My Razorpay', 'Money', 'MyRazorpay', 'MoneyTab', 'bank', 'money', 'razorpay my account keys webhook secret platform payments top up rent receive'),
    /* ---- find and watch ---- */
    E('Search everything', 'More', 'Search', 'root', 'search', 'shops', 'search find lookup'),
    E('Shop health', 'More', 'Health', 'root', 'shield', 'riders', 'health score cancellations late orders stuck rating complaints success rate attention'),
    E('System and backups', 'More', 'System', 'root', 'bolt', 'settings', 'system backups database sms provider jobs nightly status test mode back up now restore'),
    E('Export data', 'More', 'Exports', 'root', 'copy', 'money', 'export csv spreadsheet orders invoices customers download excel'),
    /* ---- platform ---- */
    E('Alerts inbox', 'More', 'Inbox', 'root', 'bell', 'alerts', 'alerts inbox notifications late orders unpaid problems clear read'),
    E('Messages to owners', 'More', 'OwnerMessages', 'root', 'megaphone', 'platform', 'messages owners announcement broadcast write send notice email'),
    E('Alert SMS', 'More', 'AlertSettings', 'MoreTab', 'message', 'catalog', 'alert sms my phone number text message critical events cost'),
    E('Notification rules', 'More', 'NotificationRules', 'MoreTab', 'tune', 'settings', 'notification rules events channels push sms escalate delivered how'),
    E('Maintenance', 'More', 'Maintenance', 'MoreTab', 'tool', 'alerts', 'maintenance pause all shops upgrade downtime message until'),
    E('Superadmin team', 'More', 'Team', 'MoreTab', 'crown', 'settings', 'team superadmins admins add revoke restore rename colleagues access'),
    E('Audit log', 'More', 'AuditLog', 'MoreTab', 'notes', 'platform', 'audit log who changed what history activity changes trail'),
    E('My account', 'More', 'MyAccount', 'MoreTab', 'user', 'shops', 'my account name login phone numbers otp alerts on this phone push notifications profile picture photo'),
    E('New shop', 'Shops', 'ShopCreate', 'ShopsTab', 'addCircle', 'shops', 'new shop create add restaurant onboard wizard map location owner design'),
    E('Sales report', 'Orders', 'SalesReport', 'OrdersTab', 'chart', 'orders', 'sales report revenue orders per day best sellers delivered cancelled'),

    /* ---- one shop ---- */
    E('Live activity', 'Shop', 'ShopLive', 'ShopsTab', 'live', 'orders', 'live activity now today orders open riders online snapshot', 'shop'),
    E('Shop orders', 'Shop', 'ShopOrders', 'ShopsTab', 'orders', 'catalog', 'orders list status cancel deliver reject refund', 'shop'),
    E('Riders and cash', 'Shop', 'ShopRiders', 'ShopsTab', 'rider', 'riders', 'riders cash held settle performance add rider photo online', 'shop'),
    E('Complaints', 'Shop', 'ShopComplaints', 'ShopsTab', 'message', 'alerts', 'complaints refund resolve missing wrong quality late customer problem', 'shop'),
    E('Messages to customers', 'Shop', 'ShopMessages', 'ShopsTab', 'megaphone', 'platform', 'messages customers riders promotion information announce push', 'shop'),
    E('Activity log', 'Shop', 'ShopActivity', 'ShopsTab', 'notes', 'settings', 'activity log who changed shop history', 'shop'),
    E('Billing and rent', 'Shop', 'ShopBilling', 'ShopsTab', 'bank', 'money', 'billing rent go live free limit unpause pause grace bill preview fixed fee override custom invoice', 'shop'),
    E('Custom invoice', 'Shop', 'CustomInvoice', 'ShopsTab', 'receipt', 'money', 'custom invoice setup fee training extra charge bill gst line items', 'shop'),
    E('Online payments (Razorpay)', 'Shop', 'ShopPayments', 'ShopsTab', 'wallet', 'orders', 'online payments razorpay keys webhook secret test refunds disputes chargebacks upi card', 'shop'),
    E('SMS wallet', 'Shop', 'ShopSms', 'ShopsTab', 'message', 'catalog', 'sms wallet balance top up prices rate cost warn block zero history', 'shop'),
    E("Shop's own SMS sender", 'Shop', 'SmsProvider', 'ShopsTab', 'phone', 'platform', 'own sms sender dlt template sender id provider keys msg91', 'shop'),
    E('Owners', 'Shop', 'ShopOwners', 'ShopsTab', 'key', 'money', 'owners add owner who can run shop phone number remove', 'shop'),
    E('Users', 'Shop', 'ShopUsers', 'ShopsTab', 'users', 'people', 'users customers riders owners role change block phone reveal cod strikes', 'shop'),
    E('Edit shop', 'Shop', 'ShopEdit', 'ShopsTab', 'edit', 'settings', 'edit shop name tagline phone address city pincode delivery radius minimum order map location latitude longitude gst fssai legal name billing email', 'shop'),
    E('Message the owner', 'Shop', 'ShopNotify', 'ShopsTab', 'bell', 'platform', 'message owner notice notify app', 'shop'),
    E('Access and maintenance', 'Shop', 'ShopAccess', 'ShopsTab', 'shield', 'alerts', 'access block owner panel pause shop maintenance suspend', 'shop'),
    E('Branding', 'Shop', 'ShopBranding', 'ShopsTab', 'palette', 'catalog', 'branding logo home pictures hero banner colours from logo app icon splash adaptive upload', 'shop'),
    E('Menu', 'Shop', 'ShopMenu', 'ShopsTab', 'food', 'catalog', 'menu items categories products stock add item dish price veg weight kind', 'shop'),
    E('CSV import', 'Shop', 'ProductImport', 'ShopsTab', 'copy', 'catalog', 'import csv upload items bulk products spreadsheet', 'shop'),
    E('Collections', 'Shop', 'Collections', 'ShopsTab', 'sparkle', 'catalog', 'collections festival specials combos deals diwali', 'shop'),
    E('Banners', 'Shop', 'Banners', 'ShopsTab', 'banner', 'catalog', 'banners offer cards home screen promotion', 'shop'),
    E('Coupons', 'Shop', 'Coupons', 'ShopsTab', 'coupon', 'money', 'coupons discount codes percent flat first order usage limit', 'shop'),

    /* ---- customer app settings (Shop > Customer app) ---- */
    E('Customer app settings', 'Shop > Customer app', 'ShopSettings', 'ShopsTab', 'tune', 'settings', 'customer app settings all hub', 'shop'),
    E('Brand and look', 'Customer app', 'SettingsBrand', 'ShopsTab', 'palette', 'settings', 'brand look colours colour primary background text font style button shape rounded pill square theme', 'shop'),
    E('Bottom tabs', 'Customer app', 'SettingsTabs', 'ShopsTab', 'menu', 'settings', 'bottom tabs navigation home search offers orders profile', 'shop'),
    E('Home layout', 'Customer app', 'SettingsHome', 'ShopsTab', 'home', 'settings', 'home layout blocks order banner categories filters bestsellers new arrivals card style big compact grid food mode veg nonveg eggless sort options filter chips', 'shop'),
    E('Words and language', 'Customer app', 'SettingsLabels', 'ShopsTab', 'message', 'settings', 'words language labels hindi english add button order button empty cart closed message text', 'shop'),
    E('App features', 'Customer app', 'SettingsFeatures', 'ShopsTab', 'tune', 'catalog', 'features veg toggle veg dot rating badge prep time serves calories special instructions schedule order reorder favourites guest browsing skip coupon field tips', 'shop'),
    E('Menu and offers', 'Customer app', 'SettingsMenuOffers', 'ShopsTab', 'coupon', 'catalog', 'menu offers out of stock dim hide group by category coupons show offers home cart', 'shop'),
    E('Orders and fees', 'Customer app', 'SettingsOrders', 'ShopsTab', 'orders', 'orders', 'orders fees accepting orders pause delivery pickup dine in minimum order delivery fee free above distance packaging charge gst tax tips cash on delivery cod limit payments', 'shop'),
    E('Opening hours', 'Customer app', 'SettingsHours', 'ShopsTab', 'clock', 'orders', 'opening hours weekly slots holiday closed dates always open closing time midnight', 'shop'),
    E('Dine in and pickup rules', 'Customer app', 'SettingsDineIn', 'ShopsTab', 'orders', 'orders', 'dine in tables walk out unpaid bill offers welcome regular happy hour refer a friend call waiter tip feedback pickup waiting change time orders at the same time cash limit strikes qr scan nudge remind limits', 'shop'),
    E('Points and rewards', 'Customer app', 'SettingsPoints', 'ShopsTab', 'coupon', 'catalog', 'points rewards loyalty customer points rider points badges top riders switch off remove', 'shop'),
    E('Riders and delivery', 'Customer app', 'SettingsRiders', 'ShopsTab', 'rider', 'riders', 'riders delivery assigning automatic manual delivery pin live tracking location updates interval safety', 'shop'),
    E('App version and alerts', 'Customer app', 'SettingsApp', 'ShopsTab', 'bolt', 'platform', 'app version minimum update force sms alerts key event new order bill', 'shop'),
];

/* ------------------------------ matching ------------------------------ */
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

function lev(a, b) {
    if (a === b) return 0;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i += 1) {
        const cur = [i];
        for (let j = 1; j <= b.length; j += 1) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = cur;
    }
    return prev[b.length];
}

// 1 exact, 0.85 starts with, 0.6 contains, 0.5 within one slip, else 0
function wordScore(q, w) {
    if (q === w) return 1;
    if (w.startsWith(q)) return 0.85;
    if (q.length >= 3 && w.includes(q)) return 0.6;
    if (q.length >= 4 && Math.abs(q.length - w.length) <= 1 && lev(q, w) <= 1) return 0.5;
    return 0;
}

// every typed word must be explained by the title or a keyword; title words count more
export function searchScreens(query, limit = 8) {
    const q = norm(query).split(' ').filter(Boolean);
    if (!q.length || norm(query).length < 2) return [];
    const out = [];
    for (const e of SCREEN_INDEX) {
        const titleW = norm(`${e.title} ${e.where}`).split(' ');
        const keyW = norm(e.keywords).split(' ');
        let total = 0;
        let ok = true;
        for (const w of q) {
            let best = 0;
            for (const x of titleW) best = Math.max(best, wordScore(w, x) * 1.2);
            for (const x of keyW) best = Math.max(best, wordScore(w, x));
            if (!best) { ok = false; break; }
            total += best;
        }
        if (ok) out.push({ ...e, score: total / q.length });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, limit);
}
