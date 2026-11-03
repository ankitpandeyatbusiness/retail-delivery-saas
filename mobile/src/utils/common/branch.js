// Which branch of the brand the app is showing right now.
// An app is built for ONE shop (BUILD_SLUG). When that shop belongs to a brand, the person can switch to another branch:
// the app then reads and writes everything under that branch's name. For a shop without branches nothing here ever changes:
// the active branch stays the build's shop, and every storage key keeps its old name.
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

export const BUILD_SLUG = Constants.expoConfig?.extra?.tenantId;
const SLUG_RE = /^[a-z0-9-]{3,40}$/;
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
