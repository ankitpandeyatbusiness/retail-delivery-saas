// The owner's alert settings. They belong to THIS phone (a shop may have a loud counter phone and a quiet personal
// one), so they are kept on the phone and never sent to the server.
import { create } from 'zustand';
import { readCache, writeCache } from '../../utils/common/cache';

const KEY = 'soundbox';

export const DEFAULTS = {
    soundbox: true,    // Soundbox mode. ON: new-order sound (chime, voice, greeting) and the app stays alive with the screen off.
                       // OFF: no new-order sound at all, here or from the server's push. ON by default so no order is missed.
    ring: true,        // the repeating chime while an order waits
    volume: 1,         // 0..1
    repeatSec: 20,     // pause between two rounds
    language: 'en',    // the language orders are read in: 'en' or 'hi' (Hindi)
    voiceId: null,     // the phone's voice for English (null = the best Indian English voice it has)
    voiceIdHi: null,   // the phone's voice for Hindi
    alwaysReady: false, // keep the app awake in the background (a permanent notification) so a new order keeps repeating with the screen off.
                        // OFF: no permanent notification; the push plays the clip and reads the order once, and the app repeats it only while it is open.
    greetFaith: null,  // a greeting of the owner's faith, e.g. 'krishna', 'salaam', 'satsriakal', 'masih' (null = none)
    callMe: false,     // address the owner ("sir", "madam" or his name) in the greeting
    addressAs: 'sir',  // how: sir | madam | name
    ownerName: '',     // the name said for addressAs 'name' (filled from the account profile when it has one)
};

export const REPEAT_CHOICES = [10, 20, 30, 60];

const clean = (v = {}) => ({
    soundbox: typeof v.soundbox === 'boolean' ? v.soundbox : DEFAULTS.soundbox,
    ring: typeof v.ring === 'boolean' ? v.ring : DEFAULTS.ring,
    volume: Number.isFinite(v.volume) ? Math.min(1, Math.max(0.2, v.volume)) : DEFAULTS.volume,
    repeatSec: REPEAT_CHOICES.includes(v.repeatSec) ? v.repeatSec : DEFAULTS.repeatSec,
    language: v.language === 'hi' ? 'hi' : 'en',
    voiceId: typeof v.voiceId === 'string' ? v.voiceId : null,
    voiceIdHi: typeof v.voiceIdHi === 'string' ? v.voiceIdHi : null,
    alwaysReady: typeof v.alwaysReady === 'boolean' ? v.alwaysReady : DEFAULTS.alwaysReady,
    greetFaith: typeof v.greetFaith === 'string' ? v.greetFaith : null,
    callMe: typeof v.callMe === 'boolean' ? v.callMe : DEFAULTS.callMe,
    addressAs: ['sir', 'madam', 'name'].includes(v.addressAs) ? v.addressAs : DEFAULTS.addressAs,
    ownerName: typeof v.ownerName === 'string' ? v.ownerName.slice(0, 30) : '',
});

export const useSoundboxStore = create((set, get) => ({
    ...DEFAULTS,
    loaded: false,

    hydrate: async () => {
        const saved = await readCache(KEY);
        set({ ...clean(saved || {}), loaded: true });
    },

    // change one or more settings
    update: (patch) => {
        const next = clean({ ...get(), ...patch });
        set(next);
        writeCache(KEY, next);
    },
}));
