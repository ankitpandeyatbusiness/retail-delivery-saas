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
export const fetchRiderLocations = () => d(api.get('/shop/riders/locations'));

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
export const setAcceptingOrders = (acceptingOrders) => d(api.put('/shop/accepting-orders', { acceptingOrders }));
// send only what changed: { hours, riders, orders:{codCap}, notifications, phone, address, delivery }
export const saveSettings = (body) => d(api.put('/shop/settings', body));

/* ------------------------------ riders ------------------------------ */
export const fetchRiders = () => d(api.get('/shop/riders'));
export const addRider = (phone, name) => d(api.post('/shop/riders', { phone, name }));
// body: { isActive?, name?, email? }
export const updateRider = (userId, body) => d(api.patch(`/shop/riders/${userId}`, body));
export const removeRider = (userId) => d(api.delete(`/shop/riders/${userId}`));

/* ------------------------------ cash on delivery with riders ------------------------------ */
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

export const fetchComplaints = (params) => d(api.get('/shop/complaints', q(params)));
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
export const rentInvoicePdfPath = (id) => `/shop/subscription/invoices/${id}/pdf`;

/* ------------------------------ activity and notifications ------------------------------ */
export const fetchActivity = (params) => d(api.get('/shop/activity', q(params)));
export const fetchShopNotifications = (params) => d(api.get('/shop/notifications', q(params)));
export const readAllShopNotifications = () => d(api.post('/shop/notifications/read-all'));
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
