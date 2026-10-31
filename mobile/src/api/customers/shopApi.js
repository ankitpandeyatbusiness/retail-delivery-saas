import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// catalog
export const fetchMenu = () => d(api.get('/catalog/menu'));
export const fetchCollections = (kind) => d(api.get('/catalog/collections', { params: { kind } }));
export const fetchProduct = (id) => d(api.get(`/catalog/products/${id}`));
export const searchProducts = (params) => d(api.get('/catalog/products', { params }));

// orders
// the customer's points at this shop: { enabled, balance, pending: { points, nextAt, items }, rules, history }
export const fetchPoints = () => d(api.get('/loyalty/me'));
// the table bill while dining in: { open, table, status, rounds, total, due } / ask for the bill
export const reportPresence = (loc) => d(api.post('/dinein/presence', { loc }));   // 'on' | 'off' | 'unknown': the guest's app says where he stands (the owner is told quietly if a guest who owes cannot be reached)
export const freeMyTable = () => d(api.post('/dinein/free'));   // everything is paid: release the table (everyone on this bill is told)
export const askLeaveShare = () => d(api.post('/dinein/leave-ask'));   // "pay my share and leave": { ok, amount, busy }
export const fetchTableBill = () => d(api.get('/dinein/bill'));
// shared tables: who sits at this table, his choice (separate bill, or join them), and the answers
export const fetchTableState = (table) => d(api.get(`/dinein/table/${table}`));                                 // { shared, occupied, parties, canSeparate, max, mine, pending }
export const enterTable = (table, choice, sessionId) => d(api.post(`/dinein/table/${table}/enter`, { choice, ...(sessionId ? { sessionId } : {}) }));   // choice: 'separate' | 'with'
export const fetchJoin = (id) => d(api.get(`/dinein/join/${id}`));                                              // { status: pending | approved | denied | expired }
export const fetchJoins = () => d(api.get('/dinein/joins'));                                                      // { items }: people asking to join my bill
export const answerJoin = (id, approve, block) => d(api.post(`/dinein/join/${id}/answer`, { approve, ...(block ? { block: true } : {}) }));   // yes gives a PIN; no with block stops them asking again
export const joinPin = (id, pin) => d(api.post(`/dinein/join/${id}/pin`, { pin }));   // the newcomer types the PIN that is on the other person's screen
export const fetchDineOffers = () => d(api.get('/dinein/offers'));   // { items: [{ kind, text }] } the table offers he can get
export const fetchDineUsual = () => d(api.get('/dinein/usual'));     // { usual: { id, brief, count } | null } what he had last time
export const fetchDineStatus = () => d(api.get('/dinein/status'));   // { busy, extraMin }: the shop is full, food may take longer
export const fetchStayOffer = () => d(api.get('/dinein/offer'));   // the shop's "stay with us" discount, while its code is unused and its clock runs
export const nudgeTable = () => d(api.post('/dinein/nudge'));   // "please bring it fast"
export const claimPaid = () => d(api.post('/dinein/paid-claim'));   // "I already paid" the bill I left unpaid
export const startOwedPayment = () => d(api.post('/dinein/owed/pay'));   // pay the bill I left unpaid, online
export const checkOwedPayment = () => d(api.post('/dinein/owed/pay/check'));
export const verifyOwedPayment = (proof) => d(api.post('/dinein/owed/pay/verify', proof));
export const startTablePayment = (scope) => d(api.post('/dinein/pay-bill', scope ? { scope } : {}));   // pay what I have ordered so far, online, from the table
export const checkTablePayment = () => d(api.post('/dinein/pay-bill/check'));
export const verifyTablePayment = (proof) => d(api.post('/dinein/pay-bill/verify', proof));
export const callTable = (kind, text) => d(api.post('/dinein/call', { kind, text }));   // call the waiter / water / cutlery / clean the table
export const setTableTip = (amount) => d(api.post('/dinein/tip', { amount }));          // the tip for the waiter, paid with the bill
export const sendTableFeedback = (body) => d(api.post('/dinein/feedback', body));      // private feedback after the meal
export const fetchReferral = () => d(api.get('/dinein/referral'));                    // my code, and how my friends are doing
export const applyReferralCode = (code) => d(api.post('/dinein/referral/apply', { code }));   // a new guest types a friend's code
export const askTableBill = () => d(api.post('/dinein/ask-bill'));
export const quoteOrder = (body) => d(api.post('/orders/quote', body));
export const placeOrder = (body, key) => d(api.post('/orders', body, { headers: { 'Idempotency-Key': key } }));
export const fetchOrders = (params) => d(api.get('/orders', { params }));
export const fetchPickupSlots = () => d(api.get('/orders/pickup-slots'));
export const fetchOrder = (id) => d(api.get(`/orders/${id}`));
export const changePickupTime = (id, pickupSlot) => d(api.post(`/orders/${id}/pickup-time`, { pickupSlot }));
export const fetchPickupDue = () => d(api.get('/orders/pickup-due'));   // { items }: pickup orders waiting for "did you collect it?"
export const answerPickup = (id, answer) => d(api.post(`/orders/${id}/pickup-answer`, { answer }));   // collected | not_wanted | later | coming | arrived | on_time | late | more_time
export const askCancelOrder = (id, note) => d(api.post(`/orders/${id}/cancel-request`, { note }));
export const cancelOrder = (id, reason) => d(api.post(`/orders/${id}/cancel`, { reason }));
export const reorderOrder = (id) => d(api.post(`/orders/${id}/reorder`));
export const rateOrder = (id, ratings) => d(api.post(`/orders/${id}/rating`, { ratings }));
export const fetchRatings = (id) => d(api.get(`/orders/${id}/rating`));

// delivery tracking: rider, ETA, delivery PIN, rider position (delivery orders only, 409 otherwise)
export const fetchTracking = (id) => d(api.get(`/orders/${id}/tracking`));

// online payment: payment-config says what this shop accepts right now, pay gives the Razorpay order,
// verify sends the proof back (the server then asks Razorpay what really happened)
export const fetchPaymentConfig = () => d(api.get('/orders/payment-config'));
export const checkOrderPayment = (id) => d(api.post(`/orders/${id}/pay/check`));   // asks Razorpay now: { paid, status, order }
export const startOrderPayment = (id) => d(api.post(`/orders/${id}/pay`));
export const verifyOrderPayment = (id, proof) => d(api.post(`/orders/${id}/pay/verify`, proof));

// favourites
export const fetchFavIds = () => d(api.get('/favourites/ids'));
export const fetchFavourites = () => d(api.get('/favourites'));
export const addFav = (id) => d(api.put(`/favourites/${id}`));
export const removeFav = (id) => d(api.delete(`/favourites/${id}`));

// addresses and profile
export const fetchAddresses = () => d(api.get('/addresses'));
export const saveAddress = (body, id) => d(id ? api.put(`/addresses/${id}`, body) : api.post('/addresses', body));
export const deleteAddress = (id) => d(api.delete(`/addresses/${id}`));
export const checkServiceable = (lat, lng) => d(api.get('/addresses/serviceability', { params: { lat, lng } }));
export const fetchMe = () => d(api.get('/me'));
export const updateMe = (body) => d(api.put('/me', body));
export const deleteMe = () => d(api.delete('/me', { data: { confirm: true } }));

// delivery rating (the rider, separate from the dishes) and complaints
export const rateDelivery = (id, body) => d(api.post(`/orders/${id}/delivery-rating`, body));
export const fetchComplaints = (id) => d(api.get(`/orders/${id}/complaints`));
export const sendComplaint = (id, body) => d(api.post(`/orders/${id}/complaints`, body));

// photo uploads: sign -> PUT the file straight to storage -> confirm (the server turns it into a WebP and gives its URL)
export const signUpload = (body) => d(api.post("/me/uploads/sign", body));
export const confirmUpload = (body) => d(api.post("/me/uploads/confirm", body));
export const deleteUpload = (id) => d(api.delete(`/me/uploads/${id}`));

// preferences: promotional messages on/off (order updates always arrive)
export const fetchPrefs = () => d(api.get("/me/prefs"));
export const updatePrefs = (body) => d(api.put("/me/prefs", body));

// services the shop offers (bulk order, tiffin, party booking, its own) and the inquiries sent for them (backend/src/routes/servicesRouter.js)
export const fetchServices = () => d(api.get('/services'));                                          // { items }
export const fetchService = (id) => d(api.get(`/services/${id}`));                                   // the service + me:{ name, phone }
export const sendInquiry = (id, body) => d(api.post(`/services/${id}/inquiries`, body));            // { name, phone, message, answers:{ questionId: value } }
export const fetchInquiry = (id) => d(api.get(`/services/inquiries/${id}`));                       // with the whole conversation
export const sendInquiryMessage = (id, body) => d(api.post(`/services/inquiries/${id}/messages`, typeof body === 'string' ? { text: body } : body));   // { text?, images? }
export const fetchMyInquiries = () => d(api.get('/services/inquiries/mine'));

// table booking (backend/src/routes/bookingsRouter.js)
export const fetchBookingConfig = () => d(api.get('/bookings/config'));                                   // { enabled, minParty, maxParty, advanceDays, today, deposit, me }
export const fetchBookingSlots = (date, party) => d(api.get('/bookings/slots', { params: { date, party } })); // { slots:[{ time, left, ok }], deposit }
export const createBooking = (body) => d(api.post('/bookings', body));                                  // { date, time, party, name, phone, note? }
export const fetchBookingCard = () => d(api.get('/bookings/card'));                                       // { card: { id, code, date, time, party, startsAt, endsAt } | null }: the allowed booking, until its slot is over
export const fetchMyBookings = () => d(api.get('/bookings/mine'));
export const fetchBookingTicket = (id) => d(api.get(`/bookings/${id}/ticket`));   // { token, code, table, date, time, qr: { size, rows } }
export const cancelBooking = (id) => d(api.post(`/bookings/${id}/cancel`));
export const payBookingAgain = (id) => d(api.post(`/bookings/${id}/pay`));                        // { booking, pay }: to pay a booking that is still held
export const verifyBooking = (id, proof) => d(api.post(`/bookings/${id}/verify`, proof));          // { paid, booking }
export const checkBooking = (id) => d(api.post(`/bookings/${id}/check`));                          // { paid, booking }
export const fetchBookingTables = (date, time, party) => d(api.get('/bookings/tables', { params: { date, time, party } }));   // { tables:[{ no, seats, state: free | taken | small }], deposit }
export const joinWaitlist = (body) => d(api.post('/bookings/waitlist', body));                      // { date, time, party, name, phone }: for a slot with no free table
export const fetchMyWaitlist = () => d(api.get('/bookings/waitlist/mine'));                          // { items }
export const leaveWaitlist = (id) => d(api.delete(`/bookings/waitlist/${id}`));
