// Terms, privacy policies and About Us (backend/src/routes/legalRouter.js). Public: no login, nothing to agree to.
import api from './client';

const d = (p) => p.then((r) => r.data);

// { key, title, body } - customer_terms, privacy, owner_terms, owner_privacy, rider_terms, rider_privacy, staff_terms, staff_privacy
export const fetchPublicLegal = (key) => d(api.get(`/legal/public/${key}`));
// { poweredBy, contactPhone, platformName, operatorName, email, address }: the "Powered by" line and the names on the About Us page
export const fetchPoweredBy = () => d(api.get('/legal/info'));
