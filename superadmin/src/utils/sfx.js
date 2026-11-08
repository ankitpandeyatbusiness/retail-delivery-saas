// The two chat tones: a soft bubble-pop when you send a message, a gentle ping when one arrives while the conversation is open.
//   playSfx('chatSent');  playSfx('chatReceived');
// They follow the phone's sound (silent = nothing) and do not stop other apps' music. Best effort: a sound problem never gets in the way.
import { Platform } from 'react-native';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { isPhoneQuiet } from '../../modules/ringer-mode';

const SOUNDS = {
    chatSent: { source: require('../../assets/sounds/chat_sent.mp3'), volume: 0.8 },
    chatReceived: { source: require('../../assets/sounds/chat_received.mp3'), volume: 0.9 },
};
const players = {};
let modeSet = false;

export async function playSfx(name, volume) {
    const def = SOUNDS[name];
    if (!def) return;
    // nothing when the phone is on silent or vibrate (on Android a new sound still plays on a silent phone, so the ringer is asked here: modules/ringer-mode)
    if (Platform.OS === 'android' && isPhoneQuiet()) return;
    try {
        if (!modeSet) { modeSet = true; await setAudioModeAsync({ playsInSilentMode: false, shouldPlayInBackground: false, interruptionMode: 'mixWithOthers' }); }
        let p = players[name];
        if (!p) { p = createAudioPlayer(def.source); players[name] = p; }
        p.volume = volume ?? def.volume ?? 1;
        await p.seekTo(0);
        p.play();
    } catch (e) { /* no sound is fine */ }
}
