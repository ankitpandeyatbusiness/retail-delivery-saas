// Reads a new order out loud when the screen is off or the app is closed.
//
// The server sends two things for a new order: the notification (Android plays the bundled "New order received" clip by
// itself) and a second SILENT data message with the order in it. The silent one has no notification inside, so Android
// hands it to the app's own code, which runs here for a few seconds in the background and speaks the order with the
// phone's voice (the voice, language and greeting the owner chose). If the phone does not allow it, nothing is lost:
// the clip has already rung, and tapping the notification reads the order.
//
// This file must be loaded when the app starts (index.js imports it first): the task has to be defined at module
// scope, because when the app is closed Android starts only the JavaScript, not the screens.
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import { speakForPush } from './soundbox';

export const SPEAK_ORDER_TASK = 'SOUNDBOX_SPEAK_ORDER';

// The payload can arrive as plain fields, or with the fields as one JSON text (dataString). Take whichever is there.
function fieldsOf(payload) {
    const d = payload?.data || {};
    let out = { ...d };
    if (typeof d.dataString === 'string') {
        try { out = { ...out, ...JSON.parse(d.dataString) }; } catch (e) { /* use what is there */ }
    }
    if (d.data && typeof d.data === 'object') out = { ...out, ...d.data };
    return out;
}

TaskManager.defineTask(SPEAK_ORDER_TASK, async ({ data, error }) => {
    if (error) return;
    const fields = fieldsOf(data);
    if (String(fields.speakOnly) !== '1') return;   // only the Soundbox's own silent message
    try { await speakForPush(fields); } catch (e) { /* best effort */ }
});

// Not in a development build. When a silent push arrives while the app is closed, Android starts the app's JavaScript
// for this task, which creates the app's React context BEFORE any screen exists. A development build (the Expo dev
// launcher) refuses that when you then open the app: "App react context shouldn't be created before", and it crashes.
// A release or preview build has no dev launcher, so the task is registered there. In development it is removed again,
// which also clears a registration left by an earlier run.
if (__DEV__) {
    Notifications.unregisterTaskAsync(SPEAK_ORDER_TASK).catch(() => { });
} else {
    Notifications.registerTaskAsync(SPEAK_ORDER_TASK).catch(() => { });   // idempotent: registering twice is harmless
}
