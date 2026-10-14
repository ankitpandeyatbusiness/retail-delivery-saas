import api, { data } from './adminClient';

export const fetchSales = (params) => data(api.get('/admin/reports/sales', { params }));
export const fetchInbox = (params) => data(api.get('/admin/notifications', { params }));
export const fetchInvoices = (params) => data(api.get('/admin/subscriptions/invoices', { params }));
export const fetchPlatform = () => data(api.get('/admin/platform'));
