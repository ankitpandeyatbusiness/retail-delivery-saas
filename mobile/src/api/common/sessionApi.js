import api from './client';

const d = (p) => p.then((r) => r.data);

// the devices this person is logged in on. { items: [{ id, current, platform: 'android'|'ios'|'web', device, city, region, country, place, loggedInAt, lastActiveAt }] }
export const fetchSessions = () => d(api.get('/auth/sessions'));
// sign ONE device out
export const endSession = (id) => d(api.delete(`/auth/sessions/${id}`));
// sign every device out except this one. { ok, ended }
export const endOtherSessions = () => d(api.post('/auth/sessions/logout-others'));
