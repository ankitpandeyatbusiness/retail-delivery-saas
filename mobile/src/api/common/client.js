import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useAppStatus } from '../../store/common/useAppStatus';
import { BUILD_SLUG, getSlug, keyFor } from '../../utils/common/branch';

const baseURL = process.env.EXPO_PUBLIC_BASE_URL || (__DEV__ ? 'http://localhost:5000/api' : '');
if (!baseURL) throw new Error('EXPO_PUBLIC_BASE_URL is not set');
if (!__DEV__ && !baseURL.startsWith('https://')) throw new Error('API must use HTTPS in production');

if (!BUILD_SLUG) throw new Error('extra.tenantId missing in app config');

// Which build this is, so the superadmin can see which versions are out there (Development details)
const appHeaders = {
    'x-app-version': String(Constants.expoConfig?.version || ''),
    'x-app-build': String(Constants.nativeBuildVersion || ''),
    'x-app-platform': Platform.OS,
    'x-app-os': String(Platform.Version || ''),
    // the website says so: the server then applies the shop's web switch (and not the installed app's). Every other request is the installed app.
    ...(Platform.OS === 'web' ? { 'x-client': 'web' } : {}),
};

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
    config.headers['x-tenant-slug'] = config.headers['x-tenant-slug'] || getSlug();   // the active branch (the build's shop unless the person switched)
    Object.assign(config.headers, appHeaders);
    config.headers['x-device-id'] = await getDeviceId();
    const { accessToken } = useAuthStore.getState();
    if (accessToken) config.headers['Authorization'] = `Bearer ${accessToken}`;
    return config;
});

let refreshPromise = null;

const refreshSession = () => {
    if (!refreshPromise) {
        refreshPromise = (async () => {
            const refreshToken = await SecureStore.getItemAsync(keyFor('refreshToken'));
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
                        headers: { 'x-tenant-slug': getSlug(), 'x-device-id': await getDeviceId() },
                    }
                );
                await SecureStore.setItemAsync(keyFor('refreshToken'), data.refreshToken);
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
    (r) => { useAppStatus.getState().setOffline(false); return r; },   // an answer came: we are online
    async (error) => {
        const original = error.config;
        // The shop is closed or paused (402) or in maintenance (503): the app shows it on a message screen. No answer at all: the app is offline.
        const code = error.response?.status;
        if (code === 503 && error.response.data?.maintenance) {
            // maintenance: no full-screen card; the bar and the grey screen show it (the server lets running orders be finished, so nobody is locked out)
            const d = error.response.data;
            const cur = useAppStatus.getState().maintenance;
            useAppStatus.getState().setMaintenance({ ...(cur || {}), phase: 'on', message: d.message || d.error || cur?.message || '', until: d.until || cur?.until || null, draining: !!d.draining });
        } else if (code === 402 || code === 503) {
            const d = error.response.data || {};
            useAppStatus.getState().setFrozen({ status: code, message: d.error || '', maintenance: !!d.maintenance, until: d.until || null });
        } else if (!error.response && error.request) useAppStatus.getState().setOffline(true);
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
export { refreshSession, baseURL };