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

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
const asUri = (v) => (v ? (String(v).startsWith('data:') || /^https?:/.test(v) ? v : `data:image/png;base64,${v}`) : null);

// -> [{ id, pkg, label, logo }]. Never throws: if the check fails we simply show none.
export async function detectInstalledUpiApps() {
    if (Platform.OS !== 'android') return [];
    try {
        const r = await withTimeout(Razorpay.getAppsWhichSupportUPI(), 4000);
        const list = (r?.data || [])
            .filter((a) => a?.packageName)
            .map((a) => ({ id: a.packageName, pkg: a.packageName, label: a.appName || a.packageName, logo: asUri(a.iconBase64) || asUri(a.appLogo) }));
        const rank = (a) => { const i = PREFERRED.indexOf(a.pkg); return i === -1 ? PREFERRED.length : i; };
        return list.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label));
    } catch (e) {
        return [];
    }
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
