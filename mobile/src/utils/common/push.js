// Notifications for the customer app:
//   - push (Firebase Cloud Messaging) so messages arrive when the app is closed
//   - the unread badge, kept live from the socket
//   - tapping a notification opens its order
// The server stores the phone's FCM token (POST /notifications/devices) and sends with firebase-admin.
// Android only for now. All of it is best effort: a failure here must never get in the way of ordering.
import { ownerRoute } from '../owners/notificationRoute';
import { Platform, AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { alertOn } from '../../store/common/useAlertPrefs';
import * as SecureStore from 'expo-secure-store';
import { CommonActions } from '@react-navigation/native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useNotificationStore } from '../../store/common/useNotificationStore';
import { registerDevice, removeDevice } from '../../api/common/notificationApi';
import { onNotification, realtimeConnected } from '../../api/common/socket';
import { showToast } from '../../components/customers/shop';
import { speakOnOpen, isNewsType } from '../owners/soundbox';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useOwedPrompt } from '../../store/customers/useOwedPrompt';
import { playSfx, buzz } from './sfx';

const TOKEN_KEY = 'pushToken';
const CHANNEL = 'orders';   // must match defaultChannel in app.config.js
// The owner's new-order channel: maximum importance and the bundled voice clip "New order received".
// The server names it in the push (backend notifications/events.js: pushChannel / pushSound). A channel's sound can not be
// changed once it exists on a phone, so a new sound needs a new channel id.
const NEW_ORDERS_CHANNEL = 'new_orders_v2';   // must match NEW_ORDER_CHANNEL in backend notifications/events.js
const CANCEL_CHANNEL = 'cancel_alert_v1';   // the cancelled-order alarm (owner, cook, waiter). Must match the backend
const HELP_CHANNEL = 'help_alarm_v1';       // the owner's: a rider pressed help
const STAFF_INFO_CHANNEL = 'staff_info_v1';   // a quiet staff message ("order handed over"): the soft ping. Must match the backend
const STAFF_CHANNEL = 'staff_alerts_v1';   // a cook's and a waiter's alerts: the "ting-tong" clip. Must match STAFF_CHANNEL in backend notifications/events.js
const OLD_NEW_ORDERS_CHANNELS = ['new_orders'];   // earlier ids: they may be stuck without the sound, so they are removed

// Every notification is shown twice on purpose, whether the app is open or not: the in-app toast and badge, AND the system banner
// (a toast fades in seconds, the banner stays in the notification list). The sound is left to the app while it is open, which plays
// its own sound for the events that have one, so it does not sound twice.
Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
        // the owner's test push has no live message behind it, so it is always shown, even with the app in front
        const isTest = notification?.request?.content?.data?.test === '1';
        const d = notification?.request?.content?.data || {};
        // a cook or a waiter with the app open hears the app's own ting-tong and voice, so the push is silent for them. They are told by
        // the app being open (not by the live connection, which can drop for a moment and let a second sound through).
        const role = useAuthStore.getState().user?.role;
        const staff = role === 'kitchen' || role === 'waiter';
        const quiet = (staff ? AppState.currentState === 'active' : realtimeConnected()) && !isTest;
        return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: !quiet, shouldSetBadge: false };
    },
});

// Messages the app already makes a sound for (the owner's Soundbox, the customer's order steps). Every other message gets one soft ping,
// because with the app open the system sound is muted on purpose: without this a pickup-time request or the shop's reply would be silent.
const QUIET_TYPES = ['table_guest_alert'];   // meant to be silent: only in the list
const SOUNDBOX_TYPES = ['order_new', 'order_unaccepted_reminder', 'order_cancelled', 'table_bill_asked', 'table_call', 'kitchen_problem', 'pickup_intent', 'rider_sos'];
function hasOwnSound(n) {
    if (QUIET_TYPES.includes(n?.type)) return true;   // no ping, no sound
    const role = useAuthStore.getState().user?.role;
    if (role === 'admin' && SOUNDBOX_TYPES.includes(n?.type)) return true;
    if (['admin', 'kitchen', 'waiter'].includes(role) && isNewsType(n?.type) && useSoundboxStore.getState().soundbox && alertOn(n.type, 's')) return true;   // the Soundbox ping + voice come instead
    if (n?.type === 'order_status' && ['accepted', 'cancelled', 'out_for_delivery'].includes(n?.data?.status)) return true;
    return false;
}

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
    // a cook's or waiter's push: the work screen is their home, there is no order page for them
    if (['kitchen', 'waiter'].includes(useAuthStore.getState().user?.role)) return;
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

    // the cancelled-order alarm: the owner, the cook and the waiter; and the owner's help alarm
    const who = useAuthStore.getState().user?.role;
    if (who === 'admin' || who === 'kitchen' || who === 'waiter') {
        try { await Notifications.setNotificationChannelAsync(CANCEL_CHANNEL, { ...loud, name: 'Cancelled orders', description: 'A short alarm when an order is cancelled', sound: 'cancel_alert.wav' }); } catch (e) { /* the push then lands on the default channel */ }
    }
    if (who === 'admin') {
        try { await Notifications.setNotificationChannelAsync(HELP_CHANNEL, { ...loud, name: 'Delivery partner needs help', description: 'A gentle alarm when a delivery partner presses the help button', sound: 'help_alarm.wav' }); } catch (e) { /* the push then lands on the default channel */ }
    }
    // the cook's and the waiter's channel: loud, with the ting-tong clip (created only on their phones)
    const role = useAuthStore.getState().user?.role;
    if (role === 'kitchen' || role === 'waiter') {
        try {
            await Notifications.setNotificationChannelAsync(STAFF_CHANNEL, { ...loud, name: 'Kitchen and waiter alerts', description: 'Rings when there is work to do', sound: 'ting_tong.wav' });
        } catch (e) { /* the push then lands on the app's default channel */ }
        try {
            await Notifications.setNotificationChannelAsync(STAFF_INFO_CHANNEL, { name: 'Kitchen and waiter updates', description: 'A soft ping when an order has left the kitchen', importance: Notifications.AndroidImportance.HIGH, sound: 'notify.wav' });
        } catch (e) { /* the push then lands on the app's default channel */ }
    }

    let { status, canAskAgain } = await Notifications.getPermissionsAsync();
    if (status !== 'granted' && canAskAgain) status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;

    const t = await Notifications.getDevicePushTokenAsync();   // { type: 'android', data: '<FCM token>' }
    return typeof t?.data === 'string' ? t.data : null;
}

// What this phone really holds for the owner's loud channel, for the Soundbox screen's "Phone check".
// Android freezes a channel's sound when it is created, so this is the truth about what a push will do here.
export async function newOrderChannelInfo(channelId = NEW_ORDERS_CHANNEL) {
    if (Platform.OS !== 'android') return { supported: false };
    try {
        const perm = await Notifications.getPermissionsAsync();
        const ch = await Notifications.getNotificationChannelAsync(channelId);
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
        if (AppState.currentState === 'active' && !hasOwnSound(n) && alertOn(n?.type, 's')) { playSfx('notify'); buzz([0, 40]); }   // the Alerts screen can switch this ping off
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
