import api, { data } from './adminClient';

export const sendOtp = (phone) => data(api.post('/admin/auth/send-otp', { phone }));
export const verifyOtp = (phone, otp) => data(api.post('/admin/auth/verify-otp', { phone, otp }));
export const fetchMe = () => data(api.get('/admin/me'));
