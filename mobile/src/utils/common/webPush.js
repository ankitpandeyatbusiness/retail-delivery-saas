// "Also notify me on this browser" (WEBSITE only; the phone app never calls this). Browser push uses the browser's own push service:
//   1. the person switches it on: the browser asks permission, we subscribe it with the server's public key,
//   2. the subscription goes to the server (POST /notifications/web-push/subscribe), which pushes to it when something happens,
//   3. the service worker (public/sw.js) shows the notification; a tap comes back as a message and opens the screen.
// The phone app has priority: the server only pushes to the browser when this is on (or when the person has no phone).
import { Platform } from 'react-native';
import api from '../../api/common/client';

const d = (p) => p.then((r) => r.data);

// the browser's own key format -> bytes
export function keyToBytes(b64) {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
    return out;
}

const env = () => (typeof window !== 'undefined' ? window : null);

export const webPushSupported = () => {
    const w = env();
    return Platform.OS === 'web' && !!w && 'serviceWorker' in navigator && 'PushManager' in w && 'Notification' in w;
};

// iPhone / iPad Safari only allows browser push for a website added to the Home Screen
export function needsHomeScreen() {
    const w = env();
    if (!w || typeof navigator === 'undefined') return false;
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = (w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
    return ios && !standalone;
}

async function currentSubscription() {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return { reg: null, sub: null };
    return { reg, sub: await reg.pushManager.getSubscription() };
}

// -> { supported, publicKey, enabled, subscribed, permission, homeScreen, noWorker }
//   publicKey null: the server has no browser push set up (the card hides itself)
//   noWorker: no service worker is running (while testing on localhost it is off unless the address ends with ?pwa=1)
export async function webPushStatus() {
    if (!webPushSupported()) return { supported: false };
    let server = { publicKey: null, enabled: false };
    try { server = await d(api.get('/notifications/web-push')); } catch (e) { /* offline: show it as off */ }
    const { reg, sub } = await currentSubscription();
    return {
        supported: true,
        publicKey: server.publicKey || null,
        enabled: !!server.enabled,
        subscribed: !!sub,
        permission: Notification.permission,
        homeScreen: needsHomeScreen(),
        noWorker: !reg,
    };
}

const safe = (m) => Object.assign(new Error(m), { safe: true });

export async function enableWebPush() {
    if (!webPushSupported()) throw safe('This browser cannot show notifications.');
    const server = await d(api.get('/notifications/web-push'));
    if (!server.publicKey) throw safe('Browser notifications are not set up yet.');
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) throw safe('Notifications are not available in this window. Open the website normally and try again.');

    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') throw safe('Notifications are blocked for this website. Allow them in the address bar of your browser, then try again.');

    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(server.publicKey) });
    await d(api.post('/notifications/web-push/subscribe', { subscription: sub.toJSON() }));
    return true;
}

export async function disableWebPush() {
    if (!webPushSupported()) return;
    const { sub } = await currentSubscription();
    if (sub) {
        try { await d(api.post('/notifications/web-push/unsubscribe', { endpoint: sub.endpoint })); } catch (e) { /* the server forgets it when the browser is gone */ }
        try { await sub.unsubscribe(); } catch (e) { /* ignore */ }
    } else {
        // nothing in this browser, but the switch may still be on for another one: tell the server this one is not subscribed
        try { await d(api.post('/notifications/web-push/unsubscribe', { endpoint: 'none' })); } catch (e) { /* ignore */ }
    }
}
