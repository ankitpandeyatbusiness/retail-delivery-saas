import api, { data } from './adminClient';

export const sendOtp = (phone) => data(api.post('/admin/auth/send-otp', { phone }));
export const verifyOtp = (phone, otp) => data(api.post('/admin/auth/verify-otp', { phone, otp }));
export const loginWithPassword = (phone, password) => data(api.post('/admin/auth/login-phone', { phone, password }));   // free, no SMS
export const setMyPassword = (body) => data(api.put('/admin/me/password', body));   // { newPassword, currentPassword? }
export const fetchMe = () => data(api.get('/admin/me'));

/* ---- my profile picture: sign -> PUT the file -> confirm ---- */
export const signMyPhoto = (body) => data(api.post('/admin/me/photo/sign', body));      // { contentType, bytes }
export const confirmMyPhoto = (key) => data(api.post('/admin/me/photo', { key }));
export const removeMyPhoto = () => data(api.delete('/admin/me/photo'));
