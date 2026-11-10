// Real-time sync between a person's devices (web phase 12). The server says 'sync:changed' { area, sid } after any successful change a person makes
// (middlewares/syncNotify.js). This device then:
//   1. ignores it when it made the change itself (sid is this device's session),
//   2. fetches again the data stores that belong to that area (onSyncArea),
//   3. makes every screen that loads on focus load again (useSyncStore.tick, hooks/common/useLiveFocus.js), but never while a text field is being
//      typed in: a refresh must not wipe what someone is writing, so it waits until they leave the field.
import { Platform, Keyboard } from 'react-native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useSyncStore } from '../../store/common/useSyncStore';
import { onSyncChanged, onResync } from '../../api/common/socket';

const handlers = [];   // { prefix, fn, timer }

// "addresses" matches "addresses" and "addresses/5"; "shop" matches "shop:products"
const matches = (area, prefix) => area === prefix || area.startsWith(`${prefix}/`) || area.startsWith(`${prefix}:`);

// fn runs (once, a moment after the last change) when another device changed this area. Returns a function that stops it.
export function onSyncArea(prefix, fn) {
    const h = { prefix, fn, timer: null };
    handlers.push(h);
    return () => { const i = handlers.indexOf(h); if (i >= 0) handlers.splice(i, 1); clearTimeout(h.timer); };
}

// the session id inside the access token (a JWT): the server puts the session of the device that made the change into the message
export function sessionIdOf(token) {
    try {
        const part = String(token || '').split('.')[1];
        if (!part) return '';
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const bin = typeof atob === 'function' ? atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) : Buffer.from(b64, 'base64').toString('binary');
        return String(JSON.parse(bin).sid || '');
    } catch (e) { return ''; }
}

// is a text field being typed in right now?
function typing() {
    try {
        if (Platform.OS === 'web') {
            const a = typeof document !== 'undefined' ? document.activeElement : null;
            return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable === true);
        }
        return typeof Keyboard.isVisible === 'function' ? Keyboard.isVisible() : false;
    } catch (e) { return false; }
}

let bumpTimer = null;
function requestRefresh() {
    if (bumpTimer) return;   // one refresh for a burst of changes
    const attempt = () => {
        if (typing()) { bumpTimer = setTimeout(attempt, 1000); return; }   // later: they are writing
        bumpTimer = null;
        useSyncStore.getState().bump();
    };
    bumpTimer = setTimeout(attempt, 500);
}

let started = false;
export function startSync() {
    if (started) return;
    started = true;
    onSyncChanged((p) => {
        if (!p || typeof p.area !== 'string') return;
        const { user, accessToken } = useAuthStore.getState();
        if (!user) return;
        if (p.sid && p.sid === sessionIdOf(accessToken)) return;   // this device made it
        for (const h of handlers) {
            if (!matches(p.area, h.prefix)) continue;
            clearTimeout(h.timer);
            h.timer = setTimeout(() => { try { h.fn(p); } catch (e) { /* one store failing must not stop the others */ } }, 300);
        }
        requestRefresh();
    });
    // back after a break (the connection returned, the app or tab came to the front): changes may have been missed
    onResync(() => { if (useAuthStore.getState().user) requestRefresh(); });
}

export const _test = { matches, sessionIdOf };
