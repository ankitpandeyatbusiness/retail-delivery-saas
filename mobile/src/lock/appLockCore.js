// The app lock: what is saved on this phone, the PIN's hash, and what the phone can do (fingerprint / face / its own screen lock).
// Nothing here goes to the server. The settings live in the phone's secure storage, one record per signed-in person.
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';

export const AUTO_CHOICES = [[0, 'Immediately'], [1, 'After 1 minute'], [5, 'After 5 minutes'], [15, 'After 15 minutes']];
export const MAX_FAILS = 5;          // this many wrong PINs and the person must sign in again
export const WAIT_AFTER = 3;         // from the 3rd wrong PIN every try waits 30 seconds
export const WAIT_SEC = 30;

export const DEFAULTS = {
    enabled: false,
    method: 'device',     // 'device' = fingerprint, face or the phone's own screen lock (PIN, pattern, password) | 'pin' = this app's own 4-digit PIN
    biometric: false,     // with 'pin': also unlock with fingerprint or face
    autoLockMin: 1,       // how long in the background before it locks (0 = at once)
    hidePreview: false,   // hide the app in the recent-apps list (and block screenshots)
    pinHash: null, salt: null,
    fails: 0, lockedUntil: 0,
};

const keyOf = (uid) => `applock.v1.${String(uid).replace(/[^A-Za-z0-9_.-]/g, '_')}`;
export async function readSettings(uid) {
    try { const raw = await SecureStore.getItemAsync(keyOf(uid)); return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) }; } catch (e) { return { ...DEFAULTS }; }
}
export async function writeSettings(uid, s) {
    try { await SecureStore.setItemAsync(keyOf(uid), JSON.stringify(s)); } catch (e) { /* the lock then stays as it was */ }
}
export async function clearSettings(uid) { try { await SecureStore.deleteItemAsync(keyOf(uid)); } catch (e) { /* nothing to clear */ } }

const hex = (bytes) => Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
export const newSalt = async () => hex(await Crypto.getRandomBytesAsync(16));
export const hashPin = (pin, salt, uid) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${uid}:${pin}`);

// what this phone can do
export async function support() {
    try {
        const hardware = await LocalAuthentication.hasHardwareAsync();
        const level = await LocalAuthentication.getEnrolledLevelAsync();   // 0 none, 1 phone screen lock, 2/3 fingerprint or face
        return { hardware, device: level >= LocalAuthentication.SecurityLevel.SECRET, biometric: level >= LocalAuthentication.SecurityLevel.BIOMETRIC_WEAK };
    } catch (e) { return { hardware: false, device: false, biometric: false }; }
}
// the phone's own prompt. biometricOnly: fingerprint or face only (the app's PIN is the way back); else the phone's screen lock is allowed too.
export async function askPhone({ message, biometricOnly, cancelLabel }) {
    try {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: message, cancelLabel: cancelLabel || 'Cancel', disableDeviceFallback: !!biometricOnly });
        return !!r.success;
    } catch (e) { return false; }
}
