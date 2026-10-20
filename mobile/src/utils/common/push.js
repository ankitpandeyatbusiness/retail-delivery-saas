// Notifications for the customer app:
//   - push (Firebase Cloud Messaging) so messages arrive when the app is closed
//   - the unread badge, kept live from the socket
//   - tapping a notification opens its order
// The server stores the phone's FCM token (POST /notifications/devices) and sends with firebase-admin.
// Android only for now. All of it is best effort: a failure here must never get in the way of ordering.
import { ownerRoute } from '../owners/notificationRoute';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { CommonActions } from '@react-navigation/native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { registerDevice, removeDevice } from '../../api/common/notificationApi';
import { onNotification, realtimeConnected } from '../../api/common/socket';
import { showToast } from '../../components/customers/shop';
import { speakOnOpen } from '../owners/soundbox';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useOwedPrompt } from '../../store/customers/useOwedPrompt';

const TOKEN_KEY = 'pushToken';
const CHANNEL = 'orders';   // must match defaultChannel in app.config.js
// The owner's new-order channel: maximum importance and the bundled voice clip "New order received".
// The server names it in the push (backend notifications/events.js: pushChannel / pushSound). A channel's sound can not be
// changed once it exists on a phone, so a new sound needs a new channel id.
const NEW_ORDERS_CHANNEL = 'new_orders_v2';   // must match NEW_ORDER_CHANNEL in backend notifications/events.js
const OLD_NEW_ORDERS_CHANNELS = ['new_orders'];   // earlier ids: they may be stuck without the sound, so they are removed

// Every notification is shown twice on purpose, whether the app is open or not: the in-app toast and badge, AND the system banner
// (a toast fades in seconds, the banner stays in the notification list). The sound is left to the app while it is open, which plays
// its own sound for the events that have one, so it does not sound twice.
Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
        // the owner's test push has no live message behind it, so it is always shown, even with the app in front
        const isTest = notification?.request?.content?.data?.test === '1';
        const d = notification?.request?.content?.data || {};
        const quiet = realtimeConnected() && !isTest;
        return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
});

/* ------------------------------ opening an order from a notification ------------------------------ */
let navRef = null;
let pending = null;   // a screen to open as soon as the navigator is ready (app was closed when the user tapped)

function openScreen(name, params) {
    if (!useAuthStore.getState().user) return;
    if (!navRef?.isReady()) { pending = { name, params }; return; }
    navRef.dispatch(CommonActions.navigate({ name, params }));
}

function openOrder(orderId) {
    if (!orderId) return;
    const user = useAuthStore.getState().user;
    if (!user) return;
    // the owner has his own order page; customers and riders keep theirs
    openScreen(user.role === 'admin' ? 'OwnerOrder' : 'OrderDetail', { id: String(orderId) });
}

// Called by the navigator once it exists, and again when it is ready.
export function bindNavigation(ref) {
    navRef = ref;
}
export function navigationReady() {
    if (pending) { const p = pending; pending = null; openScreen(p.name, p.params); }
}

const dataOf = (resp) => {
    const c = resp?.notification?.request?.content;
    return c?.data || resp?.notification?.request?.trigger?.remoteMessage?.data || {};
};

// A notification was tapped: open its order. For the owner's new-order push, Soundbox mode also reads it out.
function handleTap(resp) {
    const data = dataOf(resp);
    // the owner's test push (Soundbox screen): there is no order to open, but Soundbox reads it out like a real one
    if (data.test === '1' && useAuthStore.getState().user?.role === 'admin') {
        speakOnOpen({ ...data, orderId: 'test-push' }).catch(() => { });
        return;
    }
    // the owner: every push that has somewhere to go opens it (an order, a complaint, the bill, the SMS balance, a help request...)
    if (useAuthStore.getState().user?.role === 'admin') {
        if (data.type === 'order_new' || data.type === 'order_unaccepted_reminder') speakOnOpen(data).catch(() => { });
        const to = ownerRoute({ type: data.type, data });
        if (to) { openScreen(to.name, to.params); return; }
    }
    // a customer's reminder about the bill he left unpaid: open the bill with the Pay button
    if (/^owed_/.test(String(data.type || '')) || data.type === 'table_walkout') { useOwedPrompt.getState().show(); return; }
    if (!data.orderId) return;
    if (useAuthStore.getState().user?.role === 'admin' && (data.type === 'order_new' || data.type === 'order_unaccepted_reminder')) {
        speakOnOpen(data).catch(() => { });
    }
    openOrder(data.orderId);
}

/* ------------------------------ the phone's push token ------------------------------ */
async function getToken() {
    if (Platform.OS !== 'android') return null;

    await Notifications.setNotificationChannelAsync(CHANNEL, {
        name: 'Order updates',
        importance: Notifications.AndroidImportance.HIGH,
    });
    // The customer's live-delivery update ("Arriving in about 8 min"): quiet, so a notification that is replaced every few
    // minutes never rings again. The server sends it with a tag, so each one replaces the last.
    try {
        await Notifications.setNotificationChannelAsync('live_trip', { name: 'Live delivery', importance: Notifications.AndroidImportance.LOW });
    } catch (e) { /* the push then lands on the default channel */ }
    // The owner's loud channel. Its sound file is bundled at BUILD time (app.config.js, expo-notifications "sounds"), so a
    // phone running an older build does not have it. That must never stop push from working: fall back to the
    // default channel.
    const loud = {
        name: 'New orders',
        description: 'Rings loudly when a customer places an order',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 600, 300, 600, 300, 600],
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        audioAttributes: {
            usage: Notifications.AndroidAudioUsage.ALARM,
            contentType: Notifications.AndroidAudioContentType.SONIFICATION,
        },
    };
    for (const old of OLD_NEW_ORDERS_CHANNELS) {
        try { await Notifications.deleteNotificationChannelAsync(old); } catch (e) { /* not there */ }
    }
    try {
        await Notifications.setNotificationChannelAsync(NEW_ORDERS_CHANNEL, { ...loud, sound: 'new_order.wav' });
    } catch (e) {
        // Create NOTHING here. Android freezes a channel's sound once it exists, so a channel made now (without the
        // clip) would keep a later, correct build silent. With no channel, the push lands on the app's default one.
    }

    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const t = await Notifications.getDevicePushTokenAsync();   // { type: 'android', data: '<FCM token>' }
    return typeof t?.data === 'string' ? t.data : null;
}

// What this phone really holds for the owner's loud channel, for the Soundbox screen's "Phone check".
// Android freezes a channel's sound when it is created, so this is the truth about what a push will do here.
export async function newOrderChannelInfo() {
    if (Platform.OS !== 'android') return { supported: false };
    try {
        const perm = await Notifications.getPermissionsAsync();
        const ch = await Notifications.getNotificationChannelAsync(NEW_ORDERS_CHANNEL);
        return {
            supported: true,
            allowed: perm.status === 'granted',
            exists: !!ch,
            // Android only reports 'custom' (a sound the app set: ours), 'default' (the phone's normal ping, which it
            // falls back to when the sound file is not inside the app) or null (silent). Never the file name.
            sound: ch ? (ch.sound === undefined ? 'unknown' : ch.sound) : null,
            importance: ch?.importance ?? null,            // 5 = MAX (rings and pops up), 4 = HIGH, 3 = DEFAULT, 0/1 = silent
            vibration: !!(ch?.vibrationPattern?.length) || ch?.enableVibrate === true,
        };
    } catch (e) {
        return { supported: true, error: String(e.message || e) };
    }
}

// Owner phones tell the server whether Soundbox is on. Off means no loud new-order sound from this phone at all, so
// the server then sends its pushes to the app's normal channel. Customers and riders say nothing (undefined).
async function loudFlag() {
    if (useAuthStore.getState().user?.role !== 'admin') return undefined;
    const st = useSoundboxStore.getState();
    if (!st.loaded) await st.hydrate();
    return useSoundboxStore.getState().soundbox;
}

export async function registerPush() {
    try {
        const token = await getToken();
        if (!token) return;
        await registerDevice(token, 'android', await loudFlag());
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
        if (n?.title) showToast(n.body ? `${n.title}: ${String(n.body).slice(0, 90)}` : n.title);
    });

    // the phone got a new token: tell the server
    Notifications.addPushTokenListener(async ({ data }) => {
        if (typeof data !== 'string' || !useAuthStore.getState().user) return;
        try { await registerDevice(data, 'android', await loudFlag()); await SecureStore.setItemAsync(TOKEN_KEY, data); } catch (e) { /* retried next login */ }
    });

    // the owner switched Soundbox on or off: tell the server at once, so the very next order sounds (or not) as chosen
    useSoundboxStore.subscribe((st, prev) => {
        if (st.soundbox !== prev.soundbox && useAuthStore.getState().user?.role === 'admin') registerPush();
    });

    // tapped while the app was open or in the background
    Notifications.addNotificationResponseReceivedListener((resp) => handleTap(resp));

    // tapped while the app was closed
    Notifications.getLastNotificationResponseAsync().then((resp) => { if (resp) handleTap(resp); }).catch(() => { });
}
