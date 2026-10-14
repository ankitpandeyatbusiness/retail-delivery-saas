// Push alerts to THIS phone. The token is an FCM token; the backend sends late-order and billing alerts to it.
// Works only when the app build has Firebase (google-services.json). Without it everything here fails quietly and
// the account screen says alerts are not set up.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { registerDevice, removeDevice } from '../api/platformApi';

const TOKEN_KEY = 'rc_push_token';
const CHANNEL = 'alerts';

let configured = false;
export function configurePush() {
    if (configured) return;
    configured = true;
    try {
        Notifications.setNotificationHandler({
            handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
        });
    } catch (e) { /* older native build */ }
}

export async function pushStatus() {
    try {
        const p = await Notifications.getPermissionsAsync();
        const saved = await SecureStore.getItemAsync(TOKEN_KEY);
        return { permission: p.status, canAsk: p.canAskAgain, registered: !!saved };
    } catch (e) { return { permission: 'unavailable', canAsk: false, registered: false }; }
}

// ask: true = show the permission dialog if needed (a button was pressed). false = only if already allowed.
export async function enablePush({ ask = false } = {}) {
    try {
        configurePush();
        if (Platform.OS === 'android') {
            await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Platform alerts', importance: Notifications.AndroidImportance.HIGH });
        }
        let { status, canAskAgain } = await Notifications.getPermissionsAsync();
        if (status !== 'granted' && ask && canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
        if (status !== 'granted') return { ok: false, reason: 'permission' };

        const t = await Notifications.getDevicePushTokenAsync();
        const token = typeof t?.data === 'string' ? t.data : null;
        if (!token) return { ok: false, reason: 'token' };
        await registerDevice({ token, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
        await SecureStore.setItemAsync(TOKEN_KEY, token);
        return { ok: true };
    } catch (e) {
        return { ok: false, reason: 'unavailable' };   // usually: this build has no Firebase
    }
}

// on logout, while the login still works
export async function disablePush() {
    try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (token) { await removeDevice(token).catch(() => { }); await SecureStore.deleteItemAsync(TOKEN_KEY); }
    } catch (e) { /* best effort */ }
}
