// The rider's location while he delivers, even with the screen off or the app swiped away.
//
// Android keeps the app alive with a foreground service (the "Delivering order... sharing location" notification in the
// bar, which the rider can see and which cannot be hidden: that is what lets Android allow it). The service hands every
// GPS reading to the task below. The task sends it over the app's socket when that is connected, otherwise as a normal web
// request. When the app was swiped away the socket does not exist, so the web request is used (same rules on the server).
//
// This file must be loaded when the app starts (index.js imports it): the task is defined at module scope, because after a
// swipe Android starts only the JavaScript, not the screens.
import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import api, { refreshSession } from '../../api/common/client';
import { useAuthStore } from '../../store/common/useAuthStore';
import { sendRiderPing } from '../../api/common/socket';

export const RIDER_LOCATION_TASK = 'RIDER_LIVE_LOCATION';

// what the service did last, for the rider's status line (components/riders/LocationStatus.jsx)
const status = { fixAt: 0, fixes: 0, sentAt: 0, saved: null, reason: '', error: '' };
export const getLocationStatus = () => ({ ...status });
const state = { lastSentAt: 0, everySec: 10, idle: 0, wasOnTheWay: false };   // wasOnTheWay: the server has taken a position of this trip

async function send(c) {
    const body = {
        lat: c.latitude, lng: c.longitude,
        heading: c.heading >= 0 ? c.heading : undefined,
        speed: c.speed >= 0 ? c.speed : undefined,
        accuracy: c.accuracy >= 0 ? c.accuracy : undefined,
    };
    let ack = await sendRiderPing(body);
    if (!ack) {
        // no socket (app closed, or the server is busy and asked for polling): the web request does the same thing
        if (!useAuthStore.getState().accessToken) { try { await refreshSession(); } catch (e) { /* the request below fails quietly */ } }
        ack = (await api.post('/rider/location', body)).data;
    }
    return ack;
}

TaskManager.defineTask(RIDER_LOCATION_TASK, async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    const c = data.locations[data.locations.length - 1].coords;   // the newest reading
    status.fixAt = Date.now(); status.fixes += 1;   // the phone gave a position (even if it is not sent this time)
    const now = Date.now();
    if (now - state.lastSentAt < Math.max(2, state.everySec - 1) * 1000) return;   // the shop's chosen rhythm
    state.lastSentAt = now;
    try {
        const ack = await send(c);
        status.sentAt = Date.now(); status.saved = !!ack?.saved; status.reason = ack?.saved ? '' : (ack?.reason || (ack ? '' : 'no answer')); status.error = '';
        if (ack?.everySec) state.everySec = ack.everySec;
        // Nothing to track any more: stop after a few answers in a row. BUT "no order on the way" is also the answer for every ping
        // BEFORE the food is collected (the server tracks only from pickup): stopping then switched the service off while he waited
        // at the shop, and the customer lost him after pickup. So that answer only counts once this trip has really been tracked
        // (or after a very long silence); the screen stops the service when he has no delivery left, and pickup starts it again.
        if (ack && ack.saved === false && (ack.reason === 'no_order_on_the_way' || ack.reason === 'tracking_off')) {
            state.idle += 1;
            const limit = ack.reason === 'tracking_off' || state.wasOnTheWay ? 3 : 360;   // 360 answers = about an hour of waiting before pickup
            if (state.idle >= limit) { state.wasOnTheWay = false; await stopRiderTracking(); }
        } else if (ack?.saved) { state.idle = 0; state.wasOnTheWay = true; }
    } catch (e) { status.error = String(e?.message || e).slice(0, 60); /* no network for a moment: the next reading tries again */ }
});

export async function isRiderTracking() {
    try { return await Location.hasStartedLocationUpdatesAsync(RIDER_LOCATION_TASK); } catch (e) { return false; }
}

// Asks for the permissions (foreground first, then "all the time") and starts the service. Returns
// 'started' | 'foreground_only' (works only while the app is open) | 'denied'.
export async function startRiderTracking({ everySec = 10 } = {}) {
    if (Platform.OS !== 'android') return 'denied';
    state.everySec = everySec;
    state.idle = 0;
    const fg = await Location.requestForegroundPermissionsAsync();
    if (!fg.granted) return 'denied';
    let background = (await Location.getBackgroundPermissionsAsync()).granted;
    if (!background) background = (await Location.requestBackgroundPermissionsAsync()).granted;
    if (await isRiderTracking()) return background ? 'started' : 'foreground_only';
    await Location.startLocationUpdatesAsync(RIDER_LOCATION_TASK, {
        accuracy: Location.Accuracy.High,
        timeInterval: 5000,            // the task thins this out to the shop's rhythm
        distanceInterval: 0,
        showsBackgroundLocationIndicator: true,
        pausesUpdatesAutomatically: false,
        foregroundService: {
            notificationTitle: 'Delivering your orders',
            notificationBody: 'Sharing your live location with the customer.',
            notificationColor: '#16a34a',
            killServiceOnDestroy: false,   // keeps going after the app is swiped away
        },
    });
    return background ? 'started' : 'foreground_only';
}
// Stop and start again: the phone is asked for positions again from scratch. Used when the service runs but no position arrives.
export async function restartRiderTracking(opts) {
    await stopRiderTracking();
    await new Promise((r) => setTimeout(r, 400));
    return startRiderTracking(opts);
}


export async function stopRiderTracking() {
    try {
        if (await isRiderTracking()) await Location.stopLocationUpdatesAsync(RIDER_LOCATION_TASK);
    } catch (e) { /* already stopped */ }
}
