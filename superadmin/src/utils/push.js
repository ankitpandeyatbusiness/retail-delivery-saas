// Push alerts to THIS phone. The token is an FCM token; the backend sends late-order and billing alerts to it.
// Works only when the app build has Firebase (google-services.json). Without it everything here fails quietly and
// the account screen says alerts are not set up.
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { registerDevice, removeDevice } from '../api/platformApi';
import { openScreen } from '../navigation/ref';

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

// A tapped alert opens what it is about: a help request, an order, an invoice, the shop, or else the Alerts inbox.
let lastTapped = null;
function handleTap(resp) {
    const id = resp?.notification?.request?.identifier;
    if (id && id === lastTapped) return;   // the same tap is reported again when the app restarts
    lastTapped = id;
    const data = resp?.notification?.request?.content?.data || {};
    if (data.entryId) openScreen('Admin', { screen: 'MoreTab', params: { screen: 'SettlementEntry', params: { id: String(data.entryId) } } });
    else if (data.ticketId) openScreen('SupportDetail', { id: String(data.ticketId) });
    else if (data.orderId) openScreen('Admin', { screen: 'OrdersTab', params: { screen: 'OrderDetail', params: { orderId: String(data.orderId) } } });
    else if (data.invoiceId) openScreen('Admin', { screen: 'MoneyTab', params: { screen: 'InvoiceDetail', params: { invoiceId: String(data.invoiceId) } } });
    else if (data.tenantId) openScreen('Admin', { screen: 'ShopsTab', params: { screen: 'ShopDetail', params: { shopId: String(data.tenantId), name: data.shopName } } });
    else openScreen('Inbox');
}
let listening = false;
export function startPushTaps() {
    if (listening) return;
    listening = true;
    try {
        Notifications.addNotificationResponseReceivedListener(handleTap);
        Notifications.getLastNotificationResponseAsync().then((r) => { if (r) handleTap(r); }).catch(() => { });
    } catch (e) { /* this build has no notifications */ }
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
