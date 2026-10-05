import axios from 'axios';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../store/useAuthStore';

// Fallback to localhost if ENV is missing. Update to your ngrok URL during dev.
const baseURL = process.env.EXPO_PUBLIC_BASE_URL || 'http://localhost:5000/api';

const api = axios.create({ baseURL });

// Request Interceptor
api.interceptors.request.use(
    (config) => {
        // 1. Attach Multi-Tenant Header
        const tenantSlug = Constants.expoConfig?.extra?.tenantId || 'savera';
        config.headers['x-tenant-slug'] = tenantSlug;

        // 2. Attach Auth Token if logged in
        const { accessToken } = useAuthStore.getState();
        if (accessToken) {
            config.headers['Authorization'] = `Bearer ${accessToken}`;
        }

        return config;
    },
    (error) => Promise.reject(error)
);

// Response Interceptor (Token Rotation)
let isRefreshing = false;
let failedQueue = [];

const processQueue = (error, token = null) => {
    failedQueue.forEach((prom) => {
        if (error) prom.reject(error);
        else prom.resolve(token);
    });
    failedQueue = [];
};

api.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (isRefreshing) {
                return new Promise((resolve, reject) => {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        originalRequest.headers['Authorization'] = 'Bearer ' + token;
                        return api(originalRequest);
                    })
                    .catch((err) => Promise.reject(err));
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const refreshToken = await SecureStore.getItemAsync('refreshToken');
                if (!refreshToken) throw new Error('No refresh token');

                const { data } = await axios.post(`${baseURL}/auth/refresh`, { refreshToken }, {
                    headers: { 'x-tenant-slug': originalRequest.headers['x-tenant-slug'] }
                });

                await SecureStore.setItemAsync('refreshToken', data.refreshToken);
                useAuthStore.getState().setAccessToken(data.accessToken);

                processQueue(null, data.accessToken);
                originalRequest.headers['Authorization'] = 'Bearer ' + data.accessToken;

                return api(originalRequest);
            } catch (refreshError) {
                processQueue(refreshError, null);
                useAuthStore.getState().logout();
                return Promise.reject(refreshError);
            } finally {
                isRefreshing = false;
            }
        }

        return Promise.reject(error);
    }
);

export default api;