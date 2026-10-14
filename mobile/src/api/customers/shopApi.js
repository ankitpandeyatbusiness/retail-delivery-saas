import api from '../common/client';

const d = (p) => p.then((r) => r.data);

// catalog
export const fetchMenu = () => d(api.get('/catalog/menu'));
export const fetchCollections = (kind) => d(api.get('/catalog/collections', { params: { kind } }));
export const fetchProduct = (id) => d(api.get(`/catalog/products/${id}`));
export const searchProducts = (params) => d(api.get('/catalog/products', { params }));

// orders
export const quoteOrder = (body) => d(api.post('/orders/quote', body));
export const placeOrder = (body, key) => d(api.post('/orders', body, { headers: { 'Idempotency-Key': key } }));
export const fetchOrders = (params) => d(api.get('/orders', { params }));
export const fetchPickupSlots = () => d(api.get('/orders/pickup-slots'));
export const fetchOrder = (id) => d(api.get(`/orders/${id}`));
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
