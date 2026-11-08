// The owner's alert settings. They belong to THIS phone (a shop may have a loud counter phone and a quiet personal
// one), so they are kept on the phone and never sent to the server.
import { create } from 'zustand';
import { readCache, writeCache } from '../../utils/common/cache';
import { useLang, getLang } from '../../i18n';

const KEY = 'soundbox';

export const DEFAULTS = {
    soundbox: true,    // Soundbox mode. ON: new-order sound (chime, voice, greeting) and the app stays alive with the screen off.
                       // OFF: no new-order sound at all, here or from the server's push. ON by default so no order is missed.
    ring: true,        // the repeating chime while an order waits
    volume: 1,         // 0..1
    repeatSec: 20,     // pause between two rounds
    language: 'en',    // the language orders are read in: 'en', 'hi' (Hindi), 'mr' (Marathi), 'gu' (Gujarati), 'bn' (Bengali)
    languageSet: false, // true once the person chose the voice language by hand. Until then it follows the language of the app (every panel).
    voiceId: null,     // the phone's voice for English (null = the best Indian English voice it has)
    voiceIdHi: null,   // the phone's voice for Hindi
    voiceIds: {},      // the phone's voice for Marathi, Gujarati and Bengali: { mr: 'mr-in-x-...' }
    alwaysReady: false, // keep the app awake in the background (a permanent notification) so a new order keeps repeating with the screen off.
                        // OFF: no permanent notification; the push plays the clip and reads the order once, and the app repeats it only while it is open.
    greetFaith: null,  // a greeting of the owner's faith, e.g. 'krishna', 'salaam', 'satsriakal', 'masih' (null = none)
    callMe: false,     // address the owner ("sir", "madam" or his name) in the greeting
    addressAs: 'sir',  // how: sir | madam | name
    ownerName: '',     // the name said for addressAs 'name' (filled from the account profile when it has one)
};

export const REPEAT_CHOICES = [10, 20, 30, 60];

// the voice language that goes with the app's language (Bhojpuri has no voice of its own: Hindi)
export const spokenFor = (appLang) => (['hi', 'mr', 'gu', 'bn'].includes(appLang) ? appLang : appLang === 'bho' ? 'hi' : 'en');

const clean = (v = {}) => ({
    soundbox: typeof v.soundbox === 'boolean' ? v.soundbox : DEFAULTS.soundbox,
    ring: typeof v.ring === 'boolean' ? v.ring : DEFAULTS.ring,
    volume: Number.isFinite(v.volume) ? Math.min(1, Math.max(0.2, v.volume)) : DEFAULTS.volume,
    repeatSec: REPEAT_CHOICES.includes(v.repeatSec) ? v.repeatSec : DEFAULTS.repeatSec,
    language: ['hi', 'mr', 'gu', 'bn'].includes(v.language) ? v.language : 'en',
    languageSet: v.languageSet === true,
    voiceId: typeof v.voiceId === 'string' ? v.voiceId : null,
    voiceIdHi: typeof v.voiceIdHi === 'string' ? v.voiceIdHi : null,
    voiceIds: Object.fromEntries(Object.entries(v.voiceIds || {}).filter(([k, id]) => ['mr', 'gu', 'bn'].includes(k) && typeof id === 'string')),
    alwaysReady: false,   // the background "always ready" mode is gone: a phone that had it switched on is turned off here
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
        const c = clean(saved || {});
        // a phone from before this setting existed: a language other than English was chosen by hand; English may only be the old default
        if (!saved || typeof saved.languageSet !== 'boolean') c.languageSet = !!saved && c.language !== 'en';
        if (!c.languageSet) c.language = spokenFor(getLang());
        set({ ...c, loaded: true });
    },

    // the app's language changed (any panel): the voice follows it, unless the person chose the voice language himself
    followApp: (appLang) => {
        if (get().languageSet) return;
        const language = spokenFor(appLang);
        if (language === get().language) return;
        const next = clean({ ...get(), language, languageSet: false });
        set(next);
        if (get().loaded) writeCache(KEY, next);
    },

    // change one or more settings
    update: (patch) => {
        const next = clean({ ...get(), ...patch });
        set(next);
        writeCache(KEY, next);
    },
}));

// the app's language changed (the person picked it, or it was read at start): the voice language follows it
useLang.subscribe((state, prev) => { if (state.lang !== prev.lang) useSoundboxStore.getState().followApp(state.lang); });
