import api from './client';

const get = async (url, params) => (await api.get(url, { params })).data;

export const fetchConfig = () => get('/tenants/config');
export const fetchCategories = () => get('/catalog/categories');
export const fetchBanners = () => get('/catalog/banners');
export const fetchOffers = () => get('/catalog/offers');
export const fetchProducts = (params) => get('/catalog/products', params);