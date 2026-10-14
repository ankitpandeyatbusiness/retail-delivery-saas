import axios from 'axios';
import { useAuthStore } from '../store/useAuthStore';

const baseURL = process.env.EXPO_PUBLIC_BASE_URL || (__DEV__ ? 'http://10.0.2.2:5000/api' : '');
if (!baseURL) throw new Error('EXPO_PUBLIC_BASE_URL is not set');
if (!__DEV__ && !baseURL.startsWith('https://')) throw new Error('API must use HTTPS in production');

// No tenant header: a superadmin works across every shop.
// ngrok's free plan can answer with a "visit site" warning page instead of the API: this header skips it (harmless elsewhere).
const api = axios.create({ baseURL, timeout: 20000, headers: { 'ngrok-skip-browser-warning': 'true' } });

api.interceptors.request.use((config) => {
    const { token } = useAuthStore.getState();
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

// The admin token lives 8 hours and cannot be refreshed: a 401 on a logged-in call ends the session.
api.interceptors.response.use(
    (r) => r,
    async (error) => {
        const url = error.config?.url || '';
        if (error.response?.status === 401 && !url.startsWith('/admin/auth/')) {
            await useAuthStore.getState().logout('Your session ended. Please log in again.');
        }
        return Promise.reject(error);
    },
);

export { baseURL };
export const data = (p) => p.then((r) => r.data);

// One readable sentence from any failed call
export const errMsg = (e, fallback = 'Something went wrong. Please try again.') => {
    if (e?.response?.data?.errors?.length) return e.response.data.errors.join('\n');
    if (e?.response?.data?.error) return String(e.response.data.error);
    if (e?.code === 'ECONNABORTED' || e?.message === 'Network Error') return 'No connection. Check your internet and try again.';
    return fallback;
};

export default api;
