import api from './client';

const d = (p) => p.then((r) => r.data);

// the alerts this person can switch: { role, groups: [{ id, label, hint, can: { n, p, s }, critical, types, kinds, sample: { en, hi } | null, defaults, pref: { n, p, s } }] }
export const fetchAlertPrefs = () => d(api.get('/me/alerts'));
export const saveAlertPrefs = (prefs) => d(api.put('/me/alerts', { prefs }));   // { <groupId>: { n?, p?, s? } }
export const resetAlertPrefs = () => d(api.put('/me/alerts', { reset: true }));   // the recommended settings
