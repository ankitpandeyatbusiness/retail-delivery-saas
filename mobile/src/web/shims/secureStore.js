// Web stand-in for expo-secure-store: the browser's localStorage (same keys, same async calls).
// A browser cannot keep a secret like the phone's keystore does, so sessions stay short-lived on the server side.
const PREFIX = 'ss:';
const ls = () => { try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch (e) { return null; } };
const mem = new Map();   // when storage is blocked (private window) the value lives until the tab closes

export const AFTER_FIRST_UNLOCK = 0;
export const WHEN_UNLOCKED = 1;
export const ALWAYS = 2;
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 3;
export const WHEN_PASSCODE_SET_THIS_DEVICE_ONLY = 4;
export const ALWAYS_THIS_DEVICE_ONLY = 5;
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 6;

export async function isAvailableAsync() { return true; }
export async function getItemAsync(key) {
    const s = ls();
    try { if (s) { const v = s.getItem(PREFIX + key); return v == null ? null : v; } } catch (e) { /* fall through */ }
    return mem.has(key) ? mem.get(key) : null;
}
export async function setItemAsync(key, value) {
    const s = ls();
    try { if (s) { s.setItem(PREFIX + key, String(value)); return; } } catch (e) { /* fall through */ }
    mem.set(key, String(value));
}
export async function deleteItemAsync(key) {
    const s = ls();
    try { if (s) s.removeItem(PREFIX + key); } catch (e) { /* ignore */ }
    mem.delete(key);
}
export function getItem(key) { const s = ls(); try { return s ? s.getItem(PREFIX + key) : (mem.get(key) ?? null); } catch (e) { return null; } }
export function setItem(key, value) { const s = ls(); try { if (s) s.setItem(PREFIX + key, String(value)); else mem.set(key, String(value)); } catch (e) { /* ignore */ } }
export function canUseBiometricAuthentication() { return false; }
