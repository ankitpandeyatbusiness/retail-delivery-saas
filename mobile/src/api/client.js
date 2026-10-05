import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { useAuthStore } from '../store/useAuthStore';

const baseURL = process.env.EXPO_PUBLIC_BASE_URL || (__DEV__ ? 'http://localhost:5000/api' : '');
if (!baseURL) throw new Error('EXPO_PUBLIC_BASE_URL is not set');
if (!__DEV__ && !baseURL.startsWith('https://')) throw new Error('API must use HTTPS in production');

const tenantSlug = Constants.expoConfig?.extra?.tenantId;
if (!tenantSlug) throw new Error('extra.tenantId missing in app config');

const api = axios.create({ baseURL, timeout: 15000 });

let deviceIdPromise;
const getDeviceId = () =>
(deviceIdPromise ??= (async () => {
    let id = await SecureStore.getItemAsync('deviceId');
    if (!id) {
        id = Crypto.randomUUID();
        await SecureStore.setItemAsync('deviceId', id);
    }
    return id;
})());

api.interceptors.request.use(async (config) => {
    config.headers['x-tenant-slug'] = tenantSlug;
    config.headers['x-device-id'] = await getDeviceId();
    const { accessToken } = useAuthStore.getState();
    if (accessToken) config.headers['Authorization'] = `Bearer ${accessToken}`;
    return config;
});

let refreshPromise = null;

const refreshSession = () => {
    if (!refreshPromise) {
        refreshPromise = (async () => {
            const refreshToken = await SecureStore.getItemAsync('refreshToken');
            if (!refreshToken) {
                const e = new Error('No refresh token');
                e.fatal = true;
                throw e;
            }
            try {
                const { data } = await axios.post(
                    `${baseURL}/auth/refresh`,
                    { refreshToken },
                    {
                        timeout: 15000,
                        headers: { 'x-tenant-slug': tenantSlug, 'x-device-id': await getDeviceId() },
                    }
                );
                await SecureStore.setItemAsync('refreshToken', data.refreshToken);
                useAuthStore.getState().setAccessToken(data.accessToken);
                return data.accessToken;
            } catch (e) {
                const s = e.response?.status;
                e.fatal = s === 401 || s === 403; // only a definite rejection ends the session
                throw e;
            }
        })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
};

api.interceptors.response.use(
    (r) => r,
    async (error) => {
        const original = error.config;
        if (error.response?.status !== 401 || !original || original._retry) {
            return Promise.reject(error);
        }
        original._retry = true;
        try {
            const token = await refreshSession();
            original.headers['Authorization'] = `Bearer ${token}`;
            return api(original);
        } catch (refreshError) {
            if (refreshError.fatal) await useAuthStore.getState().logout();
            return Promise.reject(refreshError);
        }
    }
);

export default api;
export { refreshSession };