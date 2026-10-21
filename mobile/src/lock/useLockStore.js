// The app lock's state. One store, used by the lock screen, the settings page and the gate that watches the app going to the background.
import { create } from 'zustand';
import * as ScreenCapture from 'expo-screen-capture';
import { DEFAULTS, MAX_FAILS, WAIT_AFTER, WAIT_SEC, readSettings, writeSettings, clearSettings, newSalt, hashPin, askPhone } from './appLockCore';

let busy = false;   // the phone's own prompt makes the app look "in the background" for a moment: that must not lock it again
const preview = (on) => { (on ? ScreenCapture.preventScreenCaptureAsync('applock') : ScreenCapture.allowScreenCaptureAsync('applock')).catch(() => { }); };
const KEEP = ['enabled', 'method', 'biometric', 'autoLockMin', 'hidePreview', 'pinHash', 'salt', 'fails', 'lockedUntil'];
const pick = (st) => Object.fromEntries(KEEP.map((k) => [k, st[k]]));

export const useLockStore = create((set, get) => ({
    ...DEFAULTS,
    uid: null, required: false, ready: false,
    locked: false,       // the lock screen is up
    needSetup: false,    // required for this person but not set yet: the setup screen is up and cannot be closed
    bgAt: 0,

    // a person is signed in: read his settings. required = the lock cannot be switched off for him (the supreme admin).
    init: async ({ uid, required }) => {
        const s = await readSettings(uid);
        set({ ...s, uid, required: !!required, ready: true, locked: !!s.enabled, needSetup: !!required && !s.enabled });
        preview(!!s.enabled && !!s.hidePreview);
    },
    reset: () => { preview(false); set({ ...DEFAULTS, uid: null, required: false, ready: false, locked: false, needSetup: false }); },

    save: async (patch) => { set(patch); const st = get(); if (st.uid) await writeSettings(st.uid, pick(st)); if ('hidePreview' in patch || 'enabled' in patch) preview(get().enabled && get().hidePreview); },

    // switching on, by the phone's own lock / fingerprint / face (it must work once now, so nobody locks himself out)
    enableDevice: async () => {
        busy = true;
        const ok = await askPhone({ message: 'Confirm it is you to switch the lock on' });
        busy = false;
        if (!ok) return false;
        await get().save({ enabled: true, method: 'device', pinHash: null, salt: null, fails: 0, lockedUntil: 0 });
        set({ needSetup: false });
        return true;
    },
    // switching on, by a 4-digit PIN of this app
    enablePin: async (pin, biometric) => {
        const salt = await newSalt();
        await get().save({ enabled: true, method: 'pin', biometric: !!biometric, salt, pinHash: await hashPin(pin, salt, get().uid), fails: 0, lockedUntil: 0 });
        set({ needSetup: false });
    },
    // change the PIN (the person already unlocked the app)
    changePin: async (pin) => { const salt = await newSalt(); await get().save({ salt, pinHash: await hashPin(pin, salt, get().uid), fails: 0, lockedUntil: 0 }); },
    disable: async () => { if (get().required) return false; await get().save({ enabled: false, pinHash: null, salt: null, biometric: false, fails: 0, lockedUntil: 0 }); set({ locked: false }); return true; },

    // unlocking
    tryPhone: async ({ biometricOnly } = {}) => {
        busy = true;
        const ok = await askPhone({ message: 'Unlock', biometricOnly, cancelLabel: biometricOnly ? 'Use PIN' : 'Cancel' });
        busy = false;
        if (ok) { await get().save({ fails: 0, lockedUntil: 0 }); set({ locked: false }); }
        return ok;
    },
    // { ok } | { wait: seconds } | { left: tries } | { out: true }  (out: too many wrong tries: he must sign in again)
    tryPin: async (pin) => {
        const st = get();
        if (st.lockedUntil > Date.now()) return { wait: Math.ceil((st.lockedUntil - Date.now()) / 1000) };
        if ((await hashPin(pin, st.salt, st.uid)) === st.pinHash) { await get().save({ fails: 0, lockedUntil: 0 }); set({ locked: false }); return { ok: true }; }
        const fails = st.fails + 1;
        if (fails >= MAX_FAILS) return { out: true };
        const lockedUntil = fails >= WAIT_AFTER ? Date.now() + WAIT_SEC * 1000 : 0;
        await get().save({ fails, lockedUntil });
        return lockedUntil ? { wait: WAIT_SEC } : { left: MAX_FAILS - fails };
    },
    lockNow: () => { if (get().enabled) set({ locked: true }); },

    // the app went to the background / came back
    background: () => { if (!busy) set({ bgAt: Date.now() }); },
    foreground: () => {
        const st = get();
        if (busy || !st.enabled || st.locked || !st.bgAt) return;
        if (st.autoLockMin === 0 || Date.now() - st.bgAt >= st.autoLockMin * 60000) set({ locked: true });
    },
    // he forgot the PIN: forget the lock on this phone; he signs in again (OTP / password) and sets a new one. Nothing on the server is touched.
    forgot: async () => { const uid = get().uid; if (uid) await clearSettings(uid); get().reset(); },
}));
