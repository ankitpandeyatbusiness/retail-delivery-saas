// Smart table QR, Android only. A guest scanned a table QR on a phone without the app and chose "Open in the store". The Play Store link carried the table
// (see backend services/tableLanding.js), so right after the first sign in the app reads what Play kept (the "install referrer"), and puts the guest at that
// table by itself. Once only. An iPhone cannot carry anything through the App Store: there the app simply asks to scan the table QR again.
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { getSlug } from '../common/branch';
import { applyTableLink } from './tableLink';

const DONE_KEY = 'installReferrerDone';

// "shop=<slug>&table=<n>&k=<signature>"  ->  { shop, table, k } or null
export function parseReferrer(raw) {
    const s = String(raw || '');
    // Play may wrap our text: "utm_source=...&referrer=..." or hand it back as it is
    const params = new URLSearchParams(s.includes('referrer=') ? decodeURIComponent((/referrer=([^&]*)/.exec(s) || [])[1] || '') : s);
    const shop = params.get('shop'); const table = params.get('table'); const k = params.get('k');
    if (!shop || !/^\d{1,3}$/.test(table || '') || !/^[A-Za-z0-9_-]{6,40}$/.test(k || '')) return null;
    return { shop, table, k };
}

// Returns { ok, table } when a table was set, otherwise null. Safe to call on every start: it does its work only once.
export async function applyInstallReferrer() {
    if (Platform.OS !== 'android') return null;
    try {
        if (await SecureStore.getItemAsync(DONE_KEY)) return null;
        let raw = null;
        try { raw = await require('expo-application').getInstallReferrerAsync(); } catch (e) { raw = null; }   // an older build without the module: nothing to read
        await SecureStore.setItemAsync(DONE_KEY, '1');   // asked once, whatever the answer
        const p = parseReferrer(raw);
        if (!p || p.shop !== getSlug()) return null;
        const r = await applyTableLink(`${p.shop}://table/${p.table}?k=${p.k}`);
        return r.ok ? r : null;
    } catch (e) { return null; }
}
