// The UPI apps installed on this phone, as reported by Razorpay's Custom UI SDK (Android).
// Each one becomes a one-tap row on the payment screen, like Zomato / Swiggy.
//   pkg is passed back to Razorpay as `upi_app_package_name`, so exactly that app opens (no Razorpay page).
import { Platform } from 'react-native';
import Razorpay from 'react-native-customui';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LAST_KEY = 'lastUpiApp';
const PREFERRED = [   // shown first, in this order
    'com.google.android.apps.nbu.paisa.user',   // Google Pay
    'com.phonepe.app',                          // PhonePe
    'net.one97.paytm',                          // Paytm
    'in.org.npci.upiapp',                       // BHIM
    'com.dreamplug.androidapp',                 // CRED
];

// The only apps offered by name, in this order. Everything else on the phone is reached through "Other UPI app".
export const STANDARD_UPI_APPS = [
    { pkg: 'com.phonepe.app', label: 'PhonePe', mark: 'P' },
    { pkg: 'com.google.android.apps.nbu.paisa.user', label: 'Google Pay', mark: 'G' },
    { pkg: 'net.one97.paytm', label: 'Paytm', mark: 'P' },
    { pkg: 'in.org.npci.upiapp', label: 'BHIM UPI', mark: 'B' },
    { pkg: 'com.naviapp', label: 'Navi', mark: 'N' },
];

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const asUri = (v) => (v ? (String(v).startsWith('data:') || /^https?:/.test(v) ? v : `data:image/png;base64,${v}`) : null);

// -> [{ id, pkg, label, logo }]. Never throws: if the check fails we simply show none.
let cache = null;   // { at, apps }: the list is asked from the phone once, then reused for a minute
export async function detectInstalledUpiApps() {
    if (Platform.OS !== 'android') return [];
    if (cache && Date.now() - cache.at < 60000) return cache.apps;
    try {
        const r = await withTimeout(Razorpay.getAppsWhichSupportUPI(), 4000);
        const list = (r?.data || [])
            .filter((a) => a?.packageName)
            .map((a) => ({ id: a.packageName, pkg: a.packageName, label: a.appName || a.packageName, logo: asUri(a.iconBase64) || asUri(a.appLogo) }));
        const rank = (a) => { const i = PREFERRED.indexOf(a.pkg); return i === -1 ? PREFERRED.length : i; };
        const apps = list.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
        if (apps.length) cache = { at: Date.now(), apps };
        return apps;
    } catch (e) {
        return [];
    }
}

// The standard apps that are installed on this phone (with their real logo), and ONLY those: an app the customer does not have is never listed.
// If the phone cannot tell us what is installed, none are listed by name and `other` is true: the screen then offers "Other UPI app", where Android
// shows its own list of the apps that really are there. `other` is also true when the phone has UPI apps beyond these five (CRED, Amazon Pay...).
export async function standardUpiApps() {
    const found = await detectInstalledUpiApps();
    const byPkg = new Map(found.map((a) => [a.pkg, a]));
    const list = STANDARD_UPI_APPS
        .filter((a) => byPkg.has(a.pkg))
        .map((a) => ({ ...a, id: a.pkg, logo: byPkg.get(a.pkg)?.logo || null }));
    list.other = !list.length || found.some((a) => !STANDARD_UPI_APPS.some((x) => x.pkg === a.pkg));
    return list;
}

export const rememberUpiApp = (pkg) => AsyncStorage.setItem(LAST_KEY, pkg).catch(() => {});

// For "pay again" without asking: the app used last time if it is still installed, else the first installed one.
export async function defaultUpiApp() {
    const apps = await detectInstalledUpiApps();
    if (!apps.length) return null;
    let last = null;
    try { last = await AsyncStorage.getItem(LAST_KEY); } catch (e) { /* none */ }
    return apps.find((a) => a.pkg === last) || apps[0];
}
