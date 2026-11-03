import api, { data } from './adminClient';

/* ---- Platform health: one read-only summary, every card with a level 'good' | 'warn' | 'bad' ---- */
// { at, overall: { level, text, headline }, needsYou: [{ key, level, note }], system, payments, sms, rent, orders, google, shops, support, quiet, versions, notTracked }
export const fetchPlatformHealth = () => data(api.get('/admin/platform/health'));
