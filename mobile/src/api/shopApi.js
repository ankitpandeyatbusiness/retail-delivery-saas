import api from './client';

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
export const fetchOrder = (id) => d(api.get(`/orders/${id}`));
export const cancelOrder = (id, reason) => d(api.post(`/orders/${id}/cancel`, { reason }));
export const reorderOrder = (id) => d(api.post(`/orders/${id}/reorder`));
export const rateOrder = (id, ratings) => d(api.post(`/orders/${id}/rating`, { ratings }));
export const fetchRatings = (id) => d(api.get(`/orders/${id}/rating`));

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