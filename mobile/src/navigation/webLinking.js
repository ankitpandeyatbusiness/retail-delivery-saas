// Real addresses for the WEBSITE (the phone app does not use this: `webLinking` is undefined there). Every screen that is a page of the shop gets
// its own path, so the address bar, refresh, bookmarks, sharing a link and the browser's back/forward button all work like a normal website:
//   customer:  /home /search /orders /cart /account /item/<id> /orders/<id> /terms /privacy /login ...
//   owner:     /owner /owner/orders /owner/menu /owner/coupons /owner/order/<id> ...
//   rider:     /rider /rider/money /rider/trip/<orderId>      kitchen + waiter: /staff /staff/work
// Rules:
//  - The opening address "/" is NOT mapped: it keeps the old rule (logged in -> the tabs, logged out -> Login).
//  - A link opened straight (a bookmark, a shared link, a refresh) gets the tabs underneath it, so every Back arrow has somewhere to go.
//  - "<id>?" means the id is optional: no id = "add new".
//  - Left without an address on purpose (they need data that only exists in the moment, so a refresh could not rebuild them): OrderPlaced,
//    CardDetails, OwnerPay, OwnerStub, Chat. They still work in the app; the address bar just shows their name.
// /terms, /privacy and /about are also served by the Cloudflare Worker as plain public pages (deploy/cloudflare/worker.js), so a refresh there
// shows the same text without the app; inside the app the same address opens the screen with the shop's header.
import { Platform } from 'react-native';
import { getStateFromPath, getPathFromState } from '@react-navigation/native';

// legal document key <-> the word in the address (/legal/<word>); the customer's two have their own short addresses /terms and /privacy
const LEGAL_WORD = {
    customer_terms: 'terms', privacy: 'privacy', about_us: 'about',
    owner_terms: 'owner-terms', owner_privacy: 'owner-privacy',
    rider_terms: 'rider-terms', rider_privacy: 'rider-privacy',
    staff_terms: 'staff-terms', staff_privacy: 'staff-privacy',
};
const WORD_LEGAL = Object.fromEntries(Object.entries(LEGAL_WORD).map(([k, w]) => [w, k]));

export const SCREEN_PATHS = {
    Login: 'login',
    // customer pages
    Item: 'item/:id',
    OrderDetail: 'orders/:id',
    Cart: 'checkout',
    PaymentMethods: 'payment',
    Offers: 'offers',
    Bestsellers: 'bestsellers',
    Favourites: 'favourites',
    Notifications: 'notifications',
    MyBookings: 'bookings',
    BookTable: 'book-table',
    TableBill: 'table-bill',
    ScanTable: 'scan-table',
    Services: 'services',
    ServiceForm: 'services/:id',
    MyInquiries: 'inquiries',
    Inquiry: 'inquiries/:id',
    BulkOrder: 'bulk-order',
    BulkCart: 'bulk-cart',
    MyBulkOrders: 'bulk-orders',
    BulkOrderDetail: 'bulk-orders/:id',
    MyPoints: 'points',
    ReferFriend: 'refer',
    Sessions: 'sessions',
    AlertSettings: 'alerts',
    // documents
    LegalList: 'legal',
    Terms: 'terms',
    Privacy: 'privacy',
    AboutUs: 'about',
    LegalDoc: { path: 'legal/:key', parse: { key: (w) => WORD_LEGAL[w] || w }, stringify: { key: (k) => LEGAL_WORD[k] || k } },
    // rider and kitchen/waiter pages
    RiderTrip: 'rider/trip/:orderId',
    RiderDuty: 'rider/duty',
    RiderPoints: 'rider/points',
    StaffLeave: 'staff/leave',
    // owner pages
    ShopHub: 'owner/shop',
    Soundbox: 'owner/soundbox',
    OwnerMoney: 'owner/money/overview',
    OwnerOrder: 'owner/order/:id',
    OwnerRider: 'owner/rider/:userId',
    OwnerRiderMap: 'owner/rider-map',
    OwnerRiders: 'owner/riders',
    OwnerAutomations: 'owner/automations',
    OwnerPerformance: 'owner/performance',
    OwnerRiderRules: 'owner/rider-rules',
    OwnerStaff: 'owner/staff',
    OwnerCooks: 'owner/cooks',
    OwnerWaiters: 'owner/waiters',
    OwnerStaffPerson: 'owner/staff/:userId',
    OwnerAppLock: 'owner/app-lock',
    OwnerPayments: 'owner/payments',
    OwnerSms: 'owner/sms',
    OwnerWallet: 'owner/wallet',
    OwnerPlan: 'owner/plan',
    OwnerCustomers: 'owner/customers',
    OwnerCustomer: 'owner/customer/:id',
    OwnerExport: 'owner/export',
    OwnerExportBuild: 'owner/export/:key',
    OwnerCosts: 'owner/costs',
    OwnerComplaints: 'owner/complaints',
    OwnerComplaint: 'owner/complaint/:id',
    OwnerReviews: 'owner/reviews',
    OwnerMessages: 'owner/messages',
    OwnerCoupons: 'owner/coupons',
    OwnerCoupon: 'owner/coupon/:id?',
    OwnerBookings: 'owner/bookings',
    OwnerBookingDeny: 'owner/bookings/deny/:id',
    BookingScan: 'owner/booking-scan',
    OwnerBookingSettings: 'owner/booking-settings',
    OwnerInquiries: 'owner/inquiries',
    OwnerInquiry: 'owner/inquiry/:id',
    OwnerServices: 'owner/services',
    OwnerService: 'owner/service/:id?',
    OwnerBulk: 'owner/bulk',
    OwnerBulkOrder: 'owner/bulk/:id',
    OwnerBulkSettings: 'owner/bulk-settings',
    OwnerBanners: 'owner/banners',
    OwnerBanner: 'owner/banner/:id?',
    OwnerHours: 'owner/hours',
    OwnerDelivery: 'owner/delivery',
    OwnerShopSettings: 'owner/settings',
    OwnerNotifications: 'owner/notifications',
    OwnerActivity: 'owner/activity',
    OwnerClosing: 'owner/closing',
    OwnerAllBranches: 'owner/branches',
    OwnerPushMenu: 'owner/push-menu',
    OwnerBranchAlerts: 'owner/branch-alerts',
    OwnerBranchInbox: 'owner/branch-inbox',
    CustomerPreview: 'owner/preview',
    OwnerBusiness: 'owner/business',
    OwnerAutopilot: 'owner/autopilot',
    OwnerRewards: 'owner/rewards',
    OwnerDineIn: 'owner/dine-in',
    OwnerHero: 'owner/hero',
    OwnerDineInReport: 'owner/dine-in-report',
    OwnerMoneyRules: 'owner/money-rules',
    OwnerSupport: 'owner/support',
    OwnerSupportNew: 'owner/support/new',
    OwnerSupportTicket: 'owner/support/ticket/:id',
    OwnerProfile: 'owner/profile',
    OwnerPopular: 'owner/popular',
    OwnerTransactions: 'owner/transactions',
    OwnerMonth: 'owner/month/:month',
    OwnerItem: 'owner/item/:id?',
    OwnerCategories: 'owner/categories',
    OwnerCategory: 'owner/category/:id?',
    OwnerCollections: 'owner/collections',
    OwnerCollection: 'owner/collection/:id?',
    OwnerMoneyHub: 'owner/hub/money',
    OwnerShopFrontHub: 'owner/hub/shop-front',
    OwnerDeliveryHub: 'owner/hub/delivery',
    OwnerReportsHub: 'owner/hub/reports',
    OwnerInboxHub: 'owner/hub/inbox',
};

export const TAB_PATHS = {
    // customer tabs
    Home: 'home', Search: 'search', Orders: 'orders', CartTab: 'cart', Account: 'account',
    // owner tabs
    HomeTab: 'owner', OrdersTab: 'owner/orders', MenuTab: 'owner/menu', TxTab: 'owner/money', HistoryTab: 'owner/history',
    // rider tabs
    RiderHomeTab: 'rider', RiderHistoryTab: 'rider/history', RiderMoneyTab: 'rider/money', RiderProfileTab: 'rider/profile',
    // kitchen and waiter tabs
    StaffHomeTab: 'staff', StaffWorkTab: 'staff/work', StaffProfileTab: 'staff/profile',
};

// "?shop=<name>" (used before a shop has its own address) stays in the address bar while moving between pages
const keepShop = (path) => {
    try {
        const shop = new URLSearchParams(window.location.search).get('shop');
        if (!shop || /[?&]shop=/.test(path)) return path;
        return `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shop)}`;
    } catch (e) { return path; }
};

export const webLinking = Platform.OS !== 'web' ? undefined : {
    prefixes: [],
    getStateFromPath: (path, options) => {
        if (path === '/' || path === '') return undefined;   // the opening rule (initialRouteName)
        const state = getStateFromPath(path, options);
        const first = state?.routes?.[0]?.name;
        // a page opened straight: put the tabs underneath so its Back arrow goes somewhere
        if (state && first !== 'MainTabs' && first !== 'Login') {
            const routes = [{ name: 'MainTabs' }, ...state.routes];
            return { ...state, routes, index: routes.length - 1 };   // the page itself is the one in front
        }
        return state;
    },
    getPathFromState: (state, options) => keepShop(getPathFromState(state, options)),
    config: {
        screens: {
            ...SCREEN_PATHS,
            MainTabs: { path: '', screens: TAB_PATHS },
        },
    },
};
