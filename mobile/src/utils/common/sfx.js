// Short sound effects for moments in the app ("order placed", and more to come).
//
//   playSfx('orderPlaced');
//
// To add a sound: put the file in assets/sounds/, add ONE line to SOUNDS below, call playSfx('name') where it belongs.
//
// These follow the phone's sound: a phone on silent / vibrate plays nothing (playsInSilentMode is off), and other apps'
// music is not paused (mixWithOthers). Everything is best effort: a sound problem must never get in the way of the app.
import { Vibration } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';

const SOUNDS = {
    orderPlaced: { source: require('../../../assets/sounds/order_placed.wav'), volume: 0.9 },   // a bright rising "done" chime
    orderCancelled: { source: require('../../../assets/sounds/order_cancelled.wav'), volume: 0.9 },   // soft falling notes
    orderAccepted: { source: require('../../../assets/sounds/order_accepted.wav'), volume: 0.9 },   // warm rising pair
    outForDelivery: { source: require('../../../assets/sounds/out_for_delivery.wav'), volume: 0.9 },   // two scooter toots and a ding
    riderAccept: { source: require('../../../assets/sounds/rider_accept.wav'), volume: 0.9 },   // quick bright "yes"
    tingTong: { source: require('../../../assets/sounds/ting_tong.wav'), volume: 1 },   // the cook's and the waiter's alert: a doorbell "ting-tong"
    notify: { source: require('../../../assets/sounds/notify.wav'), volume: 0.8 },   // one soft ping for an ordinary message that has no sound of its own
    cancelAlarm: { source: require('../../../assets/sounds/cancel_alert.wav'), volume: 1 },   // an order was cancelled: a short falling da-da-dum, twice
    helpAlarm: { source: require('../../../assets/sounds/help_alarm.wav'), volume: 1 },   // a rider pressed the help button: a gentle pee-poo, three times
    riderReject: { source: require('../../../assets/sounds/rider_reject.wav'), volume: 0.9 },   // short low "no"
};

const players = {};
let modeSet = false;

// a short buzz (Android; iOS ignores the pattern). Best effort.
export const buzz = (pattern = [0, 60, 70, 90]) => { try { Vibration.vibrate(pattern); } catch (e) { /* ignore */ } };

export async function playSfx(name, volume) {
    const def = SOUNDS[name];
    if (!def) return;
    try {
        if (!modeSet) {
            modeSet = true;
            await setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' });
        }
        let p = players[name];
        if (!p) {
            p = createAudioPlayer(def.source);
            p.volume = def.volume ?? 1;
            players[name] = p;
        }
        p.volume = volume ?? def.volume ?? 1;
        await p.seekTo(0);
        p.play();
    } catch (e) { /* no sound is fine */ }
}
