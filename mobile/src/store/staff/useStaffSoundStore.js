// A cook's or a waiter's alert settings. They belong to THIS phone (a loud kitchen tablet, a quiet personal phone), so they are kept on the
// phone. The sound is the "ting-tong" followed by a short spoken line ("New order 1042"). Each kind of alert can be switched off by itself.
import { create } from 'zustand';
import { readCache, writeCache } from '../../utils/common/cache';

const KEY = 'staffSound';

export const KINDS = ['new', 'cancel', 'hurry', 'ready', 'call', 'bill', 'done', 'here'];

export const DEFAULTS = {
    sound: true,       // the ting-tong while the app is open (the phone's push rings when the app is closed)
    voice: true,       // the spoken line after it
    language: 'auto',  // auto = the app's language | en | hi
    volume: 1,         // 0.2..1
    kinds: { new: true, cancel: true, hurry: true, ready: true, call: true, bill: true, done: true, here: true },
};

const clean = (v = {}) => ({
    sound: typeof v.sound === 'boolean' ? v.sound : DEFAULTS.sound,
    voice: typeof v.voice === 'boolean' ? v.voice : DEFAULTS.voice,
    language: ['auto', 'en', 'hi'].includes(v.language) ? v.language : DEFAULTS.language,
    volume: Number.isFinite(v.volume) ? Math.min(1, Math.max(0.2, v.volume)) : DEFAULTS.volume,
    kinds: Object.fromEntries(KINDS.map((k) => [k, typeof v.kinds?.[k] === 'boolean' ? v.kinds[k] : DEFAULTS.kinds[k]])),
});

export const useStaffSoundStore = create((set, get) => ({
    ...DEFAULTS,
    loaded: false,
    hydrate: async () => {
        const saved = await readCache(KEY);
        set({ ...clean(saved || {}), loaded: true });
    },
    update: (patch) => {
        const next = clean({ ...get(), ...patch, kinds: { ...get().kinds, ...(patch.kinds || {}) } });
        set(next);
        writeCache(KEY, next);
    },
}));
