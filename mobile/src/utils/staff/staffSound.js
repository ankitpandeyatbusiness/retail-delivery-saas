// The cook's and the waiter's alert while the app is OPEN: the "ting-tong", a buzz and a short spoken line. With the app closed the push rings
// instead (channel staff_alerts_v1, the same clip), and while the app is open the push is kept silent (utils/common/push.js), so the two never clash.
// staffAlert() is safe to call from anywhere and as often as you like: one alert (same kind and number) sounds once in two minutes.
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { buzz } from '../common/sfx';
import { staffSay, speakStaffPush } from '../owners/soundbox';
import { alertOn } from '../../store/common/useAlertPrefs';
import { useStaffSoundStore } from '../../store/staff/useStaffSoundStore';
import { useLang } from '../../i18n';
import { useStaffAlertStore } from '../../store/staff/useStaffAlertStore';
import { useStaffStore } from '../../store/staff/useStaffStore';

const LINES = {
    en: {
        new: (a) => `New order ${a.orderNo}`,
        cancel: (a) => `Order ${a.orderNo} cancelled`,
        hurry: (a) => `Table ${a.table} is waiting`,
        ready: (a) => `Table ${a.table}, food is ready`,
        call: (a) => `Table ${a.table} is calling`,
        bill: (a) => `Table ${a.table} wants the bill`,
        here: (a) => `Pickup ${a.orderNo}, the customer is here`,
    },
    hi: {
        new: (a) => `नया ऑर्डर ${a.orderNo}`,
        cancel: (a) => `ऑर्डर ${a.orderNo} रद्द हुआ`,
        hurry: (a) => `टेबल ${a.table} इंतज़ार कर रही है`,
        ready: (a) => `टेबल ${a.table}, खाना तैयार है`,
        call: (a) => `टेबल ${a.table} बुला रही है`,
        bill: (a) => `टेबल ${a.table} को बिल चाहिए`,
        here: (a) => `पिकअप ${a.orderNo}, ग्राहक आ गया है`,
    },
};
const BUZZ = { new: [0, 250, 120, 250], cancel: [0, 400, 150, 400], hurry: [0, 200, 100, 200], ready: [0, 200, 100, 200], call: [0, 150, 80, 150], bill: [0, 150, 80, 150], here: [0, 200, 100, 200] };

const seen = new Map();
const WINDOW_MS = 120000;

function languageNow(setting) {
    if (setting === 'en' || setting === 'hi') return setting;
    return useLang.getState().lang === 'hi' ? 'hi' : 'en';
}

// a = { kind: 'new'|'cancel'|'hurry'|'ready'|'call'|'bill', orderNo?, table? }
export function staffAlert(a, { force } = {}) {
    try {
        if (!a?.kind) return;
        if (!force && AppState.currentState !== 'active') return;   // the push rings for a phone in a pocket
        if (!force && useStaffStore.getState().me?.onDuty === false) return;   // off duty: no sound and no popup
        const st = useStaffSoundStore.getState();
        const key = `${a.kind}:${a.orderNo ?? a.table ?? ''}`;
        const now = Date.now();
        if (!force) {
            if ((seen.get(key) || 0) > now - WINDOW_MS) return;
            seen.set(key, now);
            for (const [k, t] of seen) if (t < now - WINDOW_MS) seen.delete(k);
        }
        if (a.kind === 'cancel' && !force && alertOn('cancel', 'p')) useStaffAlertStore.getState().push({ id: key, kind: 'cancel', orderNo: a.orderNo, table: a.table });
        // the sound, the voice, the language and the volume are the Soundbox's (the same screen as the owner's)
        if (a.kind !== 'done') buzz(BUZZ[a.kind]);
        const language = languageNow(st.language);
        const text = LINES.en[a.kind]?.(a);
        const textHi = LINES.hi[a.kind]?.(a);
        staffSay({ ...a, speech: a.speech || text, speechHi: a.speechHi || textHi }, { force });
    } catch (e) { /* a sound problem must never get in the way of the work */ }
}

// ---- a cook or a waiter with the screen off or the app closed
// The push has already played the ting-tong (channel staff_alerts_v1). A moment later the server sends a silent data message with the line to say; the
// background task (utils/owners/backgroundTask.js) hands it here and the phone says it with its own voice, in the person's language. The same choices apply
// (sound, voice, the kind of alert). With the app open nothing is said here: the live alert already did.
export const STAFF_PUSH_TYPES = ['kitchen_new', 'kitchen_cancelled', 'kitchen_hurry', 'waiter_serve', 'waiter_cancelled', 'waiter_call', 'waiter_bill'];
export async function speakStaffForPush(data) {
    try {
        if (!STAFF_PUSH_TYPES.includes(String(data?.type))) return;
        if (AppState.currentState === 'active') return;
        await speakStaffPush(data);   // the Soundbox's voice, language and volume
    } catch (e) { /* the ting-tong has already rung */ }
}
