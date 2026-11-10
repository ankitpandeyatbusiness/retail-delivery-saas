// Which branch of the brand the app is showing right now.
// An app is built for ONE shop (BUILD_SLUG). When that shop belongs to a brand, the person can switch to another branch:
// the app then reads and writes everything under that branch's name. For a shop without branches nothing here ever changes:
// the active branch stays the build's shop, and every storage key keeps its old name.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

const SLUG_RE = /^[a-z0-9-]{3,40}$/;

// WEB only. A phone app is built for one shop; a website has to find its shop from the address:
//   1. <shop>.<base domain>   (the real way, once the domain exists; base domain = EXPO_PUBLIC_WEB_BASE_DOMAIN)
//   2. ?shop=<slug>           (testing before the domain: localhost:8081/?shop=savera; remembered for reloads)
//   3. the build's own shop   (extra.tenantId)
const WEB_BASE_DOMAIN = (process.env.EXPO_PUBLIC_WEB_BASE_DOMAIN || 'vivyaan.co.in').toLowerCase();
const WEB_SHOP_KEY = 'webShop';
function shopFromWebAddress() {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.location) return null;
    try {
        const host = String(window.location.hostname || '').toLowerCase();
        if (host.endsWith('.' + WEB_BASE_DOMAIN)) {
            const first = host.slice(0, -(WEB_BASE_DOMAIN.length + 1)).split('.').pop();
            return SLUG_RE.test(first) ? first : null;   // on a shop's own address nothing else may change the shop
        }
        const q = new URLSearchParams(window.location.search).get('shop');
        let stored = null;
        try { stored = window.localStorage.getItem(WEB_SHOP_KEY); } catch (e) { /* storage blocked */ }
        const chosen = q && SLUG_RE.test(q.toLowerCase()) ? q.toLowerCase() : (stored && SLUG_RE.test(stored) ? stored : null);
        if (chosen && chosen !== stored) { try { window.localStorage.setItem(WEB_SHOP_KEY, chosen); } catch (e) { /* ignore */ } }
        return chosen;
    } catch (e) { return null; }
}

export const BUILD_SLUG = shopFromWebAddress() || Constants.expoConfig?.extra?.tenantId;
const ACTIVE_KEY = 'activeBranch';   // the branch last used (only written once a switch happened)
const LIST_KEY = 'branchSlugs';      // branches this phone holds a login for (so a full sign-out can end them all)

let active = BUILD_SLUG;

export const getSlug = () => active;
export const isHomeBranch = (slug = active) => slug === BUILD_SLUG;
// the storage key of something for a branch: the build's own shop keeps the plain name, other branches get a suffix
export const keyFor = (base, slug = active) => (slug === BUILD_SLUG ? base : `${base}.${slug}`);

// Call once at start, BEFORE any request or saved login is read.
export async function loadActive() {
    try {
        const s = await SecureStore.getItemAsync(ACTIVE_KEY);
        if (s && SLUG_RE.test(s)) active = s;
    } catch (e) { /* stay on the build's shop */ }
    return active;
}

export async function setActive(slug) {
    if (!SLUG_RE.test(String(slug))) throw new Error('Invalid branch');
    active = slug;
    try {
        if (slug === BUILD_SLUG) await SecureStore.deleteItemAsync(ACTIVE_KEY);
        else await SecureStore.setItemAsync(ACTIVE_KEY, slug);
    } catch (e) { /* the app still works for this run */ }
}

export async function knownSlugs() {
    try {
        const raw = await SecureStore.getItemAsync(LIST_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list.filter((s) => SLUG_RE.test(String(s))) : [];
    } catch (e) { return []; }
}

export async function rememberBranch(slug) {
    const list = await knownSlugs();
    if (!list.includes(slug)) {
        try { await SecureStore.setItemAsync(LIST_KEY, JSON.stringify([...list, slug].slice(0, 12))); } catch (e) { /* ignore */ }
    }
}

// after a full sign-out: forget every branch and go back to the build's shop
export async function forgetBranches() {
    try {
        await SecureStore.deleteItemAsync(LIST_KEY);
        await SecureStore.deleteItemAsync(ACTIVE_KEY);
    } catch (e) { /* ignore */ }
    active = BUILD_SLUG;
}
