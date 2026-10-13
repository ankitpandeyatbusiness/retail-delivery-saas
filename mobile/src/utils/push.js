// Notifications for the customer app:
//   - push (Firebase Cloud Messaging) so messages arrive when the app is closed
//   - the unread badge, kept live from the socket
//   - tapping a notification opens its order
// The server stores the phone's FCM token (POST /notifications/devices) and sends with firebase-admin.
// Android only for now. All of it is best effort: a failure here must never get in the way of ordering.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { CommonActions } from '@react-navigation/native';
import { useAuthStore } from '../store/useAuthStore';
import { useNotificationStore } from '../store/useNotificationStore';
import { registerDevice, removeDevice } from '../api/notificationApi';
import { onNotification, realtimeConnected } from '../api/socket';
import { showToast } from '../components/ui/shop';

const TOKEN_KEY = 'pushToken';
const CHANNEL = 'orders';   // must match defaultChannel in app.config.js

// While the socket is connected the app shows its own toast and badge, so the system banner would be a duplicate.
Notifications.setNotificationHandler({
    handleNotification: async () => {
        const quiet = realtimeConnected();
        return { shouldShowBanner: !quiet, shouldShowList: !quiet, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
});

/* ------------------------------ opening an order from a notification ------------------------------ */
let navRef = null;
let pending = null;   // an order to open as soon as the navigator is ready (app was closed when the user tapped)

function openOrder(orderId) {
    if (!orderId) return;
    if (!useAuthStore.getState().user) return;
    if (!navRef?.isReady()) { pending = String(orderId); return; }
    navRef.dispatch(CommonActions.navigate({ name: 'OrderDetail', params: { id: String(orderId) } }));
}

// Called by the navigator once it exists, and again when it is ready.
export function bindNavigation(ref) {
    navRef = ref;
}
export function navigationReady() {
    if (pending) { const id = pending; pending = null; openOrder(id); }
}

const orderIdOf = (resp) => {
    const c = resp?.notification?.request?.content;
    return c?.data?.orderId || resp?.notification?.request?.trigger?.remoteMessage?.data?.orderId || null;
};

/* ------------------------------ the phone's push token ------------------------------ */
async function getToken() {
    if (Platform.OS !== 'android') return null;

    await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
    });

    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const t = await Notifications.getDevicePushTokenAsync();   // { type: 'android', data: '<FCM token>' }
    return typeof t?.data === 'string' ? t.data : null;
}

export async function registerPush() {
    try {
        const token = await getToken();
        if (!token) return;
        await registerDevice(token, 'android');
        await SecureStore.setItemAsync(TOKEN_KEY, token);
    } catch (e) { /* no push on this phone: the inbox and the socket still work */ }
}

// Call BEFORE the session is cleared, because the server needs the login to forget this phone.
export async function unregisterPush() {
    try {
        const token = await SecureStore.getItemAsync(TOKEN_KEY);
        if (!token) return;
        await Promise.race([removeDevice(token), new Promise((r) => setTimeout(r, 4000))]);
        await SecureStore.deleteItemAsync(TOKEN_KEY);
    } catch (e) { /* the server also forgets phones it cannot reach */ }
}

/* ------------------------------ start ------------------------------ */
let started = false;
export function startNotifications() {
    if (started) return;
    started = true;

    // logged in: register this phone and load the unread number. logged out: clear it.
    const onUser = (user) => {
        if (user) { registerPush(); useNotificationStore.getState().refresh(); } else useNotificationStore.getState().reset();
    };
    useAuthStore.subscribe((st, prev) => { if (st.user !== prev.user) onUser(st.user); });
    if (useAuthStore.getState().user) onUser(useAuthStore.getState().user);

    // a new message arrived while the app is open
    onNotification((n) => {
        useNotificationStore.getState().bump();
        if (n?.title) showToast(n.title);
    });

    // the phone got a new token: tell the server
    Notifications.addPushTokenListener(async ({ data }) => {
        if (typeof data !== 'string' || !useAuthStore.getState().user) return;
        try { await registerDevice(data, 'android'); await SecureStore.setItemAsync(TOKEN_KEY, data); } catch (e) { /* retried next login */ }
    });

    // tapped while the app was open or in the background
    Notifications.addNotificationResponseReceivedListener((resp) => openOrder(orderIdOf(resp)));

    // tapped while the app was closed
    Notifications.getLastNotificationResponseAsync().then((resp) => { const id = orderIdOf(resp); if (id) openOrder(id); }).catch(() => { });
}
