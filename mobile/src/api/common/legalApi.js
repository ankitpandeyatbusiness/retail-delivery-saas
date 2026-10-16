// Terms, agreements and the privacy policy (backend/src/routes/legalRouter.js).
import api from './client';

const d = (p) => p.then((r) => r.data);

// public, no login: 'customer_terms' | 'privacy'
export const fetchPublicLegal = (key) => d(api.get(`/legal/public/${key}`));
// { poweredBy, contactPhone } from the company that runs the platform now ("Powered by ..." and its Contact button)
export const fetchPoweredBy = () => d(api.get('/legal/info'));

// logged in (owner, rider, customer)
export const fetchLegalStatus = () => d(api.get('/legal/status'));          // { required, key, version, title, body }
export const acceptLegal = (key, version) => d(api.post('/legal/accept', { key, version }));
export const fetchLegalMine = () => d(api.get('/legal/mine'));              // { items: [{ key, title, version, mustAgree, agreedVersion, agreedAt, upToDate }] }
export const fetchLegalDoc = (key) => d(api.get(`/legal/doc/${key}`));
