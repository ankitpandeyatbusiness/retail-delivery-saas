// Which alerts this person wants (Alerts screen): n = notification, p = slider, s = tone, v = voice (and sec = how long the slider stays). The server keeps them (it also obeys them when it sends a push);
// the phone keeps a copy so the popup and the sound can be decided at once, and while the app is closed.
import { create } from 'zustand';
import { readCache, writeCache } from '../../utils/common/cache';
import { fetchAlertPrefs, saveAlertPrefs, resetAlertPrefs } from '../../api/common/alertsApi';

const KEY = 'alertPrefs';

export const useAlertPrefs = create((set, get) => ({
    groups: [],
    loaded: false,
    hydrate: async () => {
        if (get().loaded) return;
        const c = await readCache(KEY);
        if (c?.groups?.length) set({ groups: c.groups, loaded: true });
    },
    load: async () => {
        try {
            const r = await fetchAlertPrefs();
            set({ groups: r.groups || [], loaded: true });
            writeCache(KEY, { groups: r.groups || [] });
        } catch (e) { /* the copy on the phone is used */ }
    },
    // one group's switches: shown at once, then saved (put back if it could not be saved)
    change: async (id, patch) => {
        const before = get().groups;
        set({ groups: before.map((g) => (g.id === id ? { ...g, pref: { ...g.pref, ...patch } } : g)) });
        try {
            const r = await saveAlertPrefs({ [id]: patch });
            set({ groups: r.groups || [] });
            writeCache(KEY, { groups: r.groups || [] });
            return true;
        } catch (e) { set({ groups: before }); return false; }
    },
    reset: async () => {
        try {
            const r = await resetAlertPrefs();
            set({ groups: r.groups || [], loaded: true });
            writeCache(KEY, { groups: r.groups || [] });
            return true;
        } catch (e) { return false; }
    },
    clear: () => { set({ groups: [], loaded: false }); writeCache(KEY, { groups: [] }); },
}));

// Is this alert wanted? key = a notification type ('order_new') or a live alert kind ('cancel'); what = 'n' | 'p' | 's'.
// Unknown alerts and switches the group does not have are allowed: only a person's own "off" ever silences something.
// (n notification, s tone, v voice, p slider)
export function alertOn(key, what) {
    const g = useAlertPrefs.getState().groups.find((x) => x.types.includes(String(key)) || x.kinds.includes(String(key)));
    if (!g || !g.can[what]) return true;
    return g.pref[what] !== false;
}

// the group an alert belongs to, and how long its slider stays (0 = until the person closes it)
export const alertGroup = (key) => useAlertPrefs.getState().groups.find((x) => x.types.includes(String(key)) || x.kinds.includes(String(key))) || null;
export const alertSeconds = (key) => { const g = alertGroup(key); return typeof g?.pref?.sec === 'number' ? g.pref.sec : 5; };
