// Everything the shop owner's panel can call. One function per backend endpoint (backend/src/routes/shop*.js).
// All of it lives under /api/shop and needs a logged-in user with role "admin". The shared axios client adds the
// shop slug and the token, and refreshes the token by itself.
//
// Access levels on the server (so the screens know what to expect):
//   open always (even blocked / rent unpaid): orders, subscription, billing, notifications
//   open while rent is unpaid:               live, riders, cod, activity, sms, payments, reports
//   closed while rent is unpaid:             settings, accepting-orders, menu, customers, messages, complaints, uploads
import api from '../common/client';

const d = (p) => p.then((r) => r.data);
const q = (params) => ({ params });

/* ------------------------------ the shop right now ------------------------------ */
// { orders:{active,activeTotal}, riders:[], billable, revenueToday, customers, sms:{balancePaise}, billingState, openComplaints, feed }
export const fetchLive = () => d(api.get('/shop/live'));
// the whole Home screen in one call: today vs yesterday, sales by hour, orders waiting, stock, riders, complaints, SMS, rent
export const fetchDashboard = () => d(api.get('/shop/dashboard'));
export const fetchRiderLocations = () => d(api.get('/shop/riders/locations'));
// the live map in one answer: { shop, riders, trips } (see backend services/liveMap.js)
export const fetchLiveMap = () => d(api.get('/shop/live-map'));

/* ------------------------------ orders ------------------------------ */
// params: { status: 'active' | 'placed,accepted', q: '1042', from, to, page, limit }  ->  { items, counts, page, hasMore }
export const fetchOrders = (params) => d(api.get('/shop/orders', q(params)));
export const fetchOrder = (id) => d(api.get(`/shop/orders/${id}`));
// body: { status, note?, reasonCode? }   (cancelling needs a note)
export const setOrderStatus = (id, body) => d(api.patch(`/shop/orders/${id}/status`, body));
export const fetchDelivery = (id) => d(api.get(`/shop/orders/${id}/delivery`));
// body: { riderId } or { auto: true }; reason is needed when the order already has a rider
export const assignRider = (id, body) => d(api.post(`/shop/orders/${id}/assign`, body));
export const unassignRider = (id, reason) => d(api.post(`/shop/orders/${id}/unassign`, { reason }));
export const invoiceUrl = (id) => `/shop/orders/${id}/invoice`;   // a PDF: fetched as a file by the screen

/* ------------------------------ open / closed and shop settings ------------------------------ */
// setAcceptingOrders(true)                                    start taking orders (also ends a timed pause)
// setAcceptingOrders(false)                                   pause until he starts again
// setAcceptingOrders(false, { pauseMinutes: 30 })             pause for 30 minutes: the shop reopens by itself
// setAcceptingOrders(false, { untilMorning: true })           pause until 4 AM
export const setAcceptingOrders = (acceptingOrders, extra = {}) => d(api.put('/shop/accepting-orders', { acceptingOrders, ...extra }));
// the Orders tab was opened: everything under "Needs a look" counts as seen
export const markLooksSeen = () => d(api.post('/shop/orders/look-seen'));
// riders' leave: status 'pending' (default) | 'all'; decide with { approve: true | false, note? }
export const fetchLeaves = (status = 'pending') => d(api.get('/shop/riders/leaves', { params: { status } }));
export const decideLeave = (id, body) => d(api.put(`/shop/riders/leaves/${id}`, body));
// auto accept: { on, repeat: 'today' | 'daily', from?: '13:00', to?: '15:00' }  ->  { on, from, to, repeat, active }
export const fetchAutoAccept = () => d(api.get('/shop/auto-accept'));
export const saveAutoAccept = (body) => d(api.put('/shop/auto-accept', body));
// what the owner can change, as it is now: { riders:{assignMode,offerSeconds,maxActiveOrders,deliveryPin,liveTracking,locationIntervalSec,payPerDelivery}, orders:{codCap:{amount,firstOrders}} }
export const fetchSettings = () => d(api.get('/shop/settings'));
// busy mode: customers see a longer wait for a while. { extraMin:15, minutes:60 } | { extraMin:30, untilMorning:true } | { off:true }
export const setBusy = (body) => d(api.put('/shop/busy', body));
// the end-of-day summary; params { date:'2026-10-31' } (default today)
export const fetchClosingReport = (params) => d(api.get('/shop/closing-report', q(params)));
// send only what changed: { hours, riders, orders:{codCap}, notifications, phone, address, delivery }
export const saveSettings = (body) => d(api.put('/shop/settings', body));

/* ------------------------------ riders ------------------------------ */
export const fetchRiders = () => d(api.get('/shop/riders'));
export const addRider = (phone, name) => d(api.post('/shop/riders', { phone, name }));
// body: { isActive?, name?, email? }
export const updateRider = (userId, body) => d(api.patch(`/shop/riders/${userId}`, body));
export const removeRider = (userId) => d(api.delete(`/shop/riders/${userId}`));

/* ------------------------------ cash on delivery with riders ------------------------------ */
// how a rider is paid: the plan, what he earned, and (when the owner records payments) what was paid
export const fetchRiderPay = (userId) => d(api.get(`/shop/riders/${userId}/pay`));
export const saveRiderPay = (userId, pay) => d(api.put(`/shop/riders/${userId}/pay`, { pay }));   // pay: a plan, or null = same as the shop
export const recordRiderPayment = (userId, body) => d(api.post(`/shop/riders/${userId}/payments`, body));   // { amountPaise, kind?, note? }
export const voidRiderPayment = (userId, payId, reason) => d(api.delete(`/shop/riders/${userId}/payments/${payId}`, { data: { reason } }));
export const fetchCodRiders = () => d(api.get('/shop/cod/riders'));
export const fetchRiderLedger = (userId, params) => d(api.get(`/shop/cod/riders/${userId}/ledger`, q(params)));
export const recordHandover = (userId, body) => d(api.post(`/shop/cod/riders/${userId}/handover`, body));
export const adjustRiderCash = (userId, body) => d(api.post(`/shop/cod/riders/${userId}/adjust`, body));
export const fetchRiderPerformance = (params) => d(api.get('/shop/cod/performance', q(params)));

/* ------------------------------ menu ------------------------------ */
// the same five routes for each of: categories, products, banners, coupons, collections
const crud = (name) => ({
    list: (params) => d(api.get(`/shop/${name}`, q(params))),              // { items, total, page, limit }
    get: (id) => d(api.get(`/shop/${name}/${id}`)),
    create: (body) => d(api.post(`/shop/${name}`, body)),
    update: (id, body) => d(api.patch(`/shop/${name}/${id}`, body)),
    remove: (id) => d(api.delete(`/shop/${name}/${id}`)),
});
export const categories = crud('categories');
export const products = crud('products');
export const banners = crud('banners');
export const coupons = crud('coupons');
export const collections = crud('collections');
// body: { enabled?, qty?, dailyQty? }
export const setStock = (id, body) => d(api.patch(`/shop/products/${id}/stock`, body));
// the whole menu in one call: { categories (hidden too, with itemCount), products (light), truncated }
export const fetchMenu = () => d(api.get('/shop/menu'));
// { foodMode, businessType, itemKinds:[{id,label,sellBy,category}], measures:{weight:{presets,...},volume:{...}} }
export const fetchMenuOptions = () => d(api.get('/shop/menu/options'));
// sold out for a while: { available:true } | { available:false } | { available:false, minutes } | { available:false, untilMorning:true }
export const setAvailability = (id, body) => d(api.patch(`/shop/products/${id}/availability`, body));
// one portion (Half / Full) on or off: { groupId, optionId, available }
export const setOptionAvailability = (id, body) => d(api.patch(`/shop/products/${id}/option-availability`, body));
// drag order: the first id gets position 0. kind: categories | products | collections
export const reorder = (kind, ids) => d(api.put(`/shop/${kind}/order`, { ids }));

/* ------------------------------ uploads (direct to storage) ------------------------------ */
// kind: logo | product | category | banner | collection | rider | order | hero
export const signUpload = (body) => d(api.post('/shop/uploads/sign', body));       // { kind, refId?, contentType, bytes }
export const confirmUpload = (body) => d(api.post('/shop/uploads/confirm', body));  // { kind, refId?, key, replaces? }
export const reorderHeroes = (ids) => d(api.put('/shop/uploads/hero-order', { ids }));
export const deleteUpload = (id) => d(api.delete(`/shop/uploads/${id}`));

/* ------------------------------ customers, complaints, messages ------------------------------ */
export const fetchCustomers = (params) => d(api.get('/shop/customers', q(params)));
export const fetchCustomer = (userId) => d(api.get(`/shop/customers/${userId}`));
export const updateCustomer = (userId, body) => d(api.patch(`/shop/customers/${userId}`, body));   // { name?, email?, notes? }
export const allowCod = (userId) => d(api.patch(`/shop/customers/${userId}/cod-block`, { blocked: false }));

// what customers say: { kind:'dish'|'delivery', items, page, hasMore, summary:{dish:{avg,count,stars},delivery:{...}} }; params { kind, rating, page }
export const fetchReviews = (params) => d(api.get('/shop/reviews', q(params)));
export const fetchComplaints = (params) => d(api.get('/shop/complaints', q(params)));
export const fetchComplaint = (id) => d(api.get(`/shop/complaints/${id}`));
export const updateComplaint = (id, body) => d(api.patch(`/shop/complaints/${id}`, body));

export const sendMessage = (body) => d(api.post('/shop/messages', body));
export const fetchMessages = (params) => d(api.get('/shop/messages', q(params)));
export const fetchMessage = (id) => d(api.get(`/shop/messages/${id}`));

/* ------------------------------ money ------------------------------ */
export const fetchSalesReport = (params) => d(api.get('/shop/reports/sales', q(params)));   // { from, to, groupBy }
export const fetchPaymentsReport = (params) => d(api.get('/shop/payments/report', q(params)));
export const fetchRefunds = (params) => d(api.get('/shop/payments/refunds', q(params)));
export const fetchDisputes = (params) => d(api.get('/shop/payments/disputes', q(params)));
export const fetchTransactions = (params) => d(api.get('/shop/payments/transactions', q(params)));
// the year month by month: { year, years, months:[{month, inPaise, outPaise, netPaise, pendingPaise, count}], totals }
export const fetchTransactionSummary = (year) => d(api.get('/shop/payments/summary', q({ year })));
export const transactionsCsvPath = '/shop/payments/transactions';   // + params { from, to, category?, format:'csv' }

export const fetchSmsWallet = () => d(api.get('/shop/sms/wallet'));
export const fetchSmsTransactions = (params) => d(api.get('/shop/sms/transactions', q(params)));
export const fetchTopupOptions = () => d(api.get('/shop/sms/topup/options'));
export const startTopup = (body) => d(api.post('/shop/sms/topup', body));
export const fetchTopups = (params) => d(api.get('/shop/sms/topups', q(params)));

/* ------------------------------ rent and billing ------------------------------ */
export const fetchBillingStatus = () => d(api.get('/shop/billing/status'));
export const fetchBillingPrompts = () => d(api.get('/shop/billing/prompts'));
export const answerBillingPrompt = (kind, choice) => d(api.post('/shop/billing/prompts/choice', { kind, choice }));
export const fetchRentInvoices = (params) => d(api.get('/shop/subscription/invoices', q(params)));
export const payRentInvoice = (id) => d(api.post(`/shop/subscription/invoices/${id}/pay`));
/* ------------------------------ help & support (works even when the shop is paused for rent) ------------------------------ */
export const fetchSupportInfo = () => d(api.get('/shop/support/info'));                 // { phone, whatsapp, email, hours, replyPromise }
export const fetchSupport = (params) => d(api.get('/shop/support', q(params)));         // { items, unreadCount, page, hasMore }; params { status:'open'|'resolved', page }
export const createSupport = (body) => d(api.post('/shop/support', body));              // { category, subject, message, photos?, appVersion?, platform? }
export const fetchSupportTicket = (id) => d(api.get(`/shop/support/${id}`));
export const replySupport = (id, body) => d(api.post(`/shop/support/${id}/reply`, body));   // { message, photos? }
export const resolveSupport = (id) => d(api.post(`/shop/support/${id}/resolve`));
export const rateSupport = (id, body) => d(api.post(`/shop/support/${id}/rate`, body));     // { stars, comment? }
export const signSupportPhoto = (body) => d(api.post('/shop/support/uploads/sign', body));
export const confirmSupportPhoto = (body) => d(api.post('/shop/support/uploads/confirm', body));

// the progress report. range: '7' | '30' | '90' | '2026-09' (a past month). See backend services/businessReport.js for the shape.
export const fetchBusinessReport = (range) => d(api.get('/shop/business-report', q({ range })));

// the owner's own profile: { id, phone, name, email, emailRequired, avatarUrl, avatarId }. PUT { name }; the phone cannot be changed
export const fetchProfile = () => d(api.get('/shop/profile'));
export const saveProfile = (body) => d(api.put('/shop/profile', body));   // { name } (the email changes only with a code)
// the email: mail a 6-digit code to the address, then save the address with the code. send-code -> { sent, resendInSec, devCode? (test setups only) }
export const sendEmailCode = (email) => d(api.post('/shop/profile/email/send-code', { email }));
export const verifyEmailCode = (email, code) => d(api.post('/shop/profile/email/verify', { email, code }));
// Pay with a UPI app or a card (Razorpay checkout in the app): start -> pay -> verify
export const startRentPay = (id) => d(api.post(`/shop/subscription/invoices/${id}/pay/start`));
export const verifyRentPay = (id, proof) => d(api.post(`/shop/subscription/invoices/${id}/pay/verify`, proof));
// Everything owed (every unpaid month and its late fees) as one list, and one payment for all of it
export const fetchDues = () => d(api.get('/shop/subscription/dues'));
export const startDuesPay = () => d(api.post('/shop/subscription/dues/pay/start'));
export const verifyDuesPay = (proof) => d(api.post('/shop/subscription/dues/pay/verify', proof));
export const startTopupPay = (amountPaise) => d(api.post('/shop/sms/topup/start', { amountPaise }));
export const verifyTopupPay = (id, proof) => d(api.post(`/shop/sms/topup/${id}/verify`, proof));
export const rentInvoicePdfPath = (id) => `/shop/subscription/invoices/${id}/pdf`;
export const creditNotePdfPath = (id) => `/shop/subscription/credit-notes/${id}/pdf`;   // issued when a bill was cancelled
export const topupInvoicePdfPath = (id) => `/shop/sms/topups/${id}/invoice`;               // the tax invoice / receipt of a paid SMS top-up

/* ------------------------------ activity and notifications ------------------------------ */
export const fetchActivity = (params) => d(api.get('/shop/activity', q(params)));
export const fetchShopNotifications = (params) => d(api.get('/shop/notifications', q(params)));
export const readAllShopNotifications = () => d(api.post('/shop/notifications/read-all'));
// "Clear all": hides every message of the owner's inbox
export const clearShopNotifications = () => d(api.delete('/shop/notifications'));
export const readShopNotification = (id) => d(api.post(`/shop/notifications/${id}/read`));

// What a failed call says, in the server's own words (they are written for the owner).
export const apiError = (e, fallback = 'Something went wrong. Please try again.') => e?.response?.data?.error || fallback;
// The server answers 403 { paused: true } (rent unpaid) or { blocked: true } (panel switched off by the platform).
export const accessState = (e) => {
    const x = e?.response?.data;
    if (x?.blocked) return 'blocked';
    if (x?.paused) return 'paused';
    return null;
};

/* ------------------------------ customer profiles, Remind, Autopilot ------------------------------ */
// { counts:{new,regular,loyal,vip,slipping,lost}, total, items:[{id,name,phone,tag,vip,orders,spent,daysSince,usualHourLabel,usualDay,favourites,reachable,reachNote,...}], hasMore }
export const fetchCustomerInsights = (params) => d(api.get('/shop/customers/insights', q(params)));
export const fetchCustomerInsight = (userId) => d(api.get(`/shop/customers/${userId}/insight`));
// the message he will see, and whether it can go now: { title, body, canSend, holdBack, maxDiscount }
export const fetchRemindPreview = (userId, offer) => d(api.get(`/shop/customers/${userId}/remind`, q({ offer: offer ? 'true' : undefined })));
export const sendRemind = (userId, body) => d(api.post(`/shop/customers/${userId}/remind`, body));   // { title?, body?, withOffer? }
// settings: { on:{welcome,thanks,winback,mealtime,festival,dailySummary,weeklyDigest}, frequency, language, maxDiscount, quietFrom, quietTo, summaryHour, custom, recommended, names, limits }
export const fetchAutopilot = () => d(api.get('/shop/autopilot'));
export const saveAutopilot = (body) => d(api.put('/shop/autopilot', body));   // any part, or { recommended: true }
export const fetchAutopilotLibrary = (params) => d(api.get('/shop/autopilot/library', q(params)));
// { sent, broughtBack, orders, revenue, byKind, recent }
export const fetchAutopilotStats = (days = 30) => d(api.get('/shop/autopilot/stats', q({ days })));
