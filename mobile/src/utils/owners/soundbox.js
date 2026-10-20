// The new-order alert of the owner's phone ("Soundbox").
//
//   A new order arrives while the app is running (live message over the socket):
//     - the chime repeats every `repeatSec` seconds until the owner opens the order, or the order is no longer
//       "placed" (accepted by someone else, cancelled by the customer, timed out)
//     - in Soundbox mode each round also READS the order out loud:
//       "New order. 2 Butter Naan, 1 Laccha Paratha ... Total 540 rupees. Cash on delivery."
//   The app is closed or the screen is off:
//     - the push plays the bundled voice clip "New order received" on the loud `new_orders` channel (see push.js).
//       A push can not read the items. When the owner TAPS it and Soundbox mode is on, the app opens and speaks
//       the order once (speakOnOpen).
//   Soundbox mode also keeps the app alive with the screen off: a silent track plays inside Android's
//   media-playback foreground service, and the screen is kept awake while the app is in front.
//
// Everything is best effort: an audio problem must never get in the way of taking an order.
import { AppState } from 'react-native';
import * as Speech from 'expo-speech';
import { createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { setRinging } from '../../store/owners/useAlertStore';
import { onNotification, onOrderUpdate, realtimeConnected } from '../../api/common/socket';
import { playSfx } from '../common/sfx';
import api from '../../api/common/client';
import { fetchOrders, fetchOrder } from '../../api/owners/shopApi';
import { buildGreeting } from './greetings';

const SPEECH_TIMEOUT_MS = 20000;
const WAKE_TAG = 'soundbox';
const ALERT_TYPES = ['order_new', 'order_unaccepted_reminder'];

// ONE audio player does everything, so nothing inside the app competes for audio focus (two players did: the chime
// paused the keep-alive and Android then stopped treating the app as playing). It plays either
//   idle  - a silent track on loop, which keeps Android's media-playback foreground service (the "Soundbox is on"
//           notification) and so the app alive with the screen off, or
//   alert - the bell followed by a minute of silence. The rounds restart it from the top ON TIME (see onClock below);
//           if JavaScript is ever frozen it simply loops by itself, so the bell still comes once a minute.
const IDLE_TRACK = require('../../../assets/sounds/silence.wav');
const ALERT_TRACK = require('../../../assets/sounds/alert_60.wav');

const pending = new Map();    // orderId -> { orderNo, speech }
const acked = new Set();      // orders the owner already opened: they do not ring again
let player = null;            // the one audio player
let trackNow = null;          // what it has loaded: 'idle' or 'alert'
let wantPlaying = false;      // Soundbox is on: the player must keep playing, whatever pauses it
let speaking = false;         // the voice is talking: the player is allowed to stay paused, or it takes focus back and cuts the voice off
let lastResume = 0;

// AUDIO FOCUS. Android lets only one app "own" the audio. A player that asks for focus makes music, podcasts and videos in
// other apps pause, and they do not always restart. The silent keep-alive plays all day, so it must NEVER ask for focus:
//   idle  -> 'mixWithOthers'  no focus requested: other apps play as usual while Soundbox is on
//   alert -> 'duckOthers'     an order is ringing: other apps get quieter (they are not paused), full volume afterwards
// expo-audio asks for focus when a track STARTS playing and gives it back only when playback stops, so changing the mode
// means: pause, wait until it has really stopped, change the mode, play again.
const MODE_FOR = { idle: 'mixWithOthers', alert: 'duckOthers' };
let modeNow = null;           // the focus mode currently set
let switching = false;        // changing mode: the pause is on purpose, so the auto-resume must not undo it
let lockScreenOn = false;   // the media session (the "Soundbox is on" notification) exists
let trackChain = Promise.resolve();   // track changes happen one after the other, in order
let pausedWaiters = [];       // resolved by the player's next "not playing" report (event driven: no timers needed)

// A short memory of what the Soundbox did, shown on the Soundbox screen ("If orders are missed"). When the phone freezes
// the app with the screen off, the gaps in these times show it.
const eventLog = [];
const note = (msg) => {
    eventLog.push({ at: Date.now(), msg });
    if (eventLog.length > 60) eventLog.shift();
};
export const getSoundboxLog = () => eventLog.slice().reverse();
export const clearSoundboxLog = () => { eventLog.length = 0; };

// the voice is done: the player may play again
function voiceDone() {
    speaking = false;
    if (wantPlaying) { try { player?.play(); } catch (e) { /* ignore */ } }
}
let looping = false;
let unsubs = [];
let started = false;
let audioReady = false;

const settings = () => useSoundboxStore.getState();
const isOwner = () => useAuthStore.getState().user?.role === 'admin';

/* ------------------------------ audio ------------------------------ */
async function setMode(mode) {
    if (modeNow === mode) return;
    try {
        await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: mode });
        modeNow = mode;
    } catch (e) { /* keep the previous mode */ }
}

async function ensureAudio() {
    if (audioReady) return;
    await setMode(MODE_FOR.idle);   // start without asking for focus
    audioReady = true;
}

// resolves when the player has really stopped (its next "not playing" report), or after a second at most
function untilPaused() {
    return new Promise((resolve) => {
        if (!player || player.playing === false) { resolve(); return; }
        const done = () => { pausedWaiters = pausedWaiters.filter((w) => w !== done); resolve(); };
        pausedWaiters.push(done);
        setTimeout(done, 1000);
    });
}

function getPlayer() {
    if (!player) {
        player = createAudioPlayer(IDLE_TRACK);
        trackNow = 'idle';
        player.loop = true;
        player.volume = 0.02;
        // Something paused us (the voice reading an order, a phone call, another app taking audio focus): play again at
        // once, or Android stops the foreground service and freezes the app with the screen off.
        player.addListener('playbackStatusUpdate', (status) => {
            onClock(status);   // the alert's clock (works with the screen off, unlike JavaScript timers)
            if (!status?.playing && pausedWaiters.length) pausedWaiters.slice().forEach((w) => w());
            if (!wantPlaying || status?.playing || speaking || switching) return;   // while the voice talks, or the mode changes, it may stay paused
            const now = Date.now();
            note('player was paused: playing again');
            if (now - lastResume < 700) return;   // not a tight loop if something keeps taking focus
            lastResume = now;
            try { player.play(); } catch (e) { /* ignore */ }
        });
    }
    return player;
}

// kind: 'alert' (the repeating chime) or 'idle' (the silent keep-alive). Changes are queued so they never overlap.
function setTrack(kind) {
    trackChain = trackChain.then(() => applyTrack(kind)).catch(() => { /* never let audio break the chain */ });
}

async function applyTrack(kind) {
    try {
        // 'off': nothing plays and nothing is kept alive: the notification in the notification panel goes away
        if (kind === 'off') {
            wantPlaying = false;
            resetClock();
            if (player) {
                try { player.pause(); } catch (e) { /* ignore */ }
                try { { lockScreenOn = false; player.setActiveForLockScreen?.(false); } } catch (e) { /* ignore */ }
                switching = true;   // the pause is on purpose
                await untilPaused();
                await setMode(MODE_FOR.idle);
            }
            return;
        }
        const p = getPlayer();
        wantPlaying = true;

        // a different focus mode (idle <-> alert): stop, let Android give the focus back, switch, and play again below
        if (modeNow !== MODE_FOR[kind]) {
            switching = true;
            try { p.pause(); } catch (e) { /* ignore */ }
            await untilPaused();
            await setMode(MODE_FOR[kind]);
        }

        const changed = kind !== trackNow;
        if (changed) {
            p.replace(kind === 'alert' ? ALERT_TRACK : IDLE_TRACK);
            trackNow = kind;
        }
        p.loop = true;
        // with the chime switched off the same track still runs, silently: it is the clock the voice rounds follow
        p.volume = kind === 'alert' ? (settings().ring ? settings().volume : 0) : 0.02;
        if (kind === 'alert') {
            if (changed || phase === 'off') startRound();   // a new alert: bell at once, then the voice
            else p.play();
        } else {
            resetClock();
            p.play();
        }
        // the notification of the media-playback foreground service ("Soundbox is on")
        // The lock-screen session is made ONCE. Asking for it again while one exists (a quick idle -> alert change) builds a
        // second session with the same id and the app crashes ("Session ID must be unique"); later changes only update the text.
        const meta = { title: kind === 'alert' ? 'New order' : 'Soundbox is on', artist: useThemeStore.getState().theme?.name || 'Your shop' };
        if (!lockScreenOn) { lockScreenOn = true; p.setActiveForLockScreen?.(true, meta); } else p.updateLockScreenMetadata?.(meta);
    } catch (e) { /* a missing sound is not an error worth stopping for */ } finally { switching = false; }
}

// The phone's voices, read once.
let voicesCache = null;
const lang = (v) => String(v.language || '').replace('_', '-').toLowerCase();
const base = (v) => lang(v).split('-')[0];
const variantOf = (v) => String(v.identifier || '').toLowerCase().match(/-x-([a-z]{3})/)?.[1] || null;   // "ena" in en-in-x-ena-local

// The voices for one language ('en' = English, 'hi' = Hindi), best first: that language's Indian voice, then high
// quality, then voices that work offline. The phone lists many voices twice (an offline and a network copy); one is kept.
export async function listVoices(language = settings().language) {
    if (!voicesCache) {
        try { voicesCache = await Speech.getAvailableVoicesAsync(); } catch (e) { voicesCache = []; }
    }
    const want = language === 'hi' ? 'hi' : 'en';
    const home = want === 'hi' ? 'hi-in' : 'en-in';
    const score = (v) => (lang(v) === home ? 0 : 2)
        + (String(v.quality).toLowerCase() === 'enhanced' ? -0.5 : 0)
        + (/network|online/i.test(String(v.identifier)) ? 0.3 : 0);   // offline works without internet
    // Only Indian voices (en-IN / hi-IN) are offered. Other English voices (US, UK, Australia...) are used only when the
    // phone has no Indian one at all, so the owner always has something to pick.
    const sameLanguage = voicesCache.filter((x) => base(x) === want);
    const indian = sameLanguage.filter((x) => lang(x) === home);
    const best = new Map();
    for (const v of indian.length ? indian : sameLanguage) {
        const key = lang(v) + '|' + (variantOf(v) || v.identifier);
        const cur = best.get(key);
        if (!cur || score(v) < score(cur)) best.set(key, v);
    }
    return [...best.values()].sort((x, y) => score(x) - score(y));
}

// Owners remember a voice by a short Indian name instead of a code like "en-in-x-ena-local". The same voice has the same
// name on every phone (Google's Indian English voices are ena..ene, Hindi hia..hie), and the name is only a label.
const EN_NAMES = ['Kiran', 'Arya', 'Tara', 'Neel', 'Sunny'];
const HI_NAMES = ['Jyoti', 'Dev', 'Ishan', 'Ravi', 'Raj'];
// the voices we suggest first: Neel for English (variant 'end'), Ravi for Hindi (variant 'hid')
const RECOMMENDED = { en: 'end', hi: 'hid' };
const OTHER_NAMES = ['Mohan', 'Sita', 'Gopal', 'Radha', 'Vikram', 'Anita', 'Karan', 'Pooja'];
export function voiceLabel(v) {
    const id = String(v.identifier || v.name || '').toLowerCase();
    const l = lang(v);
    const hindi = l.startsWith('hi');
    const variant = variantOf(v);
    const idx = variant ? variant.charCodeAt(2) - 97 : -1;
    let name;
    if (idx >= 0 && idx < 5) name = (hindi ? HI_NAMES : EN_NAMES)[idx];
    else {
        let h = 0;
        for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 997;
        name = OTHER_NAMES[h % OTHER_NAMES.length];
    }
    const kind = l === 'en-in' ? 'Indian English' : hindi ? 'Hindi' : l.startsWith('en') ? 'English (' + (l.split('-')[1] || '').toUpperCase() + ')' : l;
    const quality = String(v.quality).toLowerCase() === 'enhanced' ? ' · high quality' : '';
    const recommended = variant !== null && variant === RECOMMENDED[hindi ? 'hi' : 'en'] && (l === 'en-in' || l === 'hi-in');
    return { name, sub: kind + quality, recommended };
}

// The list the Soundbox screen shows: every name appears once.
export async function labelledVoices(language = settings().language) {
    const used = new Map();
    const rows = (await listVoices(language)).map((voice) => {
        const { name, sub, recommended } = voiceLabel(voice);
        const n = (used.get(name) || 0) + 1;
        used.set(name, n);
        return { voice, name: n > 1 ? name + ' ' + n : name, sub, recommended };
    });
    // the recommended voice goes on top (the rest keep their order)
    return [...rows.filter((r) => r.recommended), ...rows.filter((r) => !r.recommended)];
}

// Hindi is only used when this phone really has a Hindi voice; otherwise the order is read in English.
async function languageToUse() {
    if (settings().language !== 'hi') return 'en';
    return (await listVoices('hi')).length ? 'hi' : 'en';
}

async function pickVoice(language) {
    const all = (await labelledVoices(language)).map((r) => r.voice);   // the recommended voice first
    const chosen = language === 'hi' ? settings().voiceIdHi : settings().voiceId;
    const voice = all.find((v) => v.identifier === chosen) || all[0] || null;
    return voice && (await engineHasVoices()) ? voice : null;
}

// Ask the phone's speech engine right now whether it can list its voices. Naming a voice while the engine cannot (it is
// starting up, was switched, or has no voice data) makes the speak call fail inside the phone ("getVoices(...) must not be
// null"). Without a named voice the phone simply uses its default one.
async function engineHasVoices() {
    try {
        const live = await Speech.getAvailableVoicesAsync();
        if (live && live.length) return true;
    } catch (e) { /* fall through */ }
    voicesCache = null;   // read the list again next time
    return false;
}

const SAMPLE = {
    en: 'New order. 2 Butter Naan, 1 Paneer Butter Masala. Total 540 rupees. Cash on delivery.',
    hi: 'नया ऑर्डर। 2 Butter Naan, 1 Paneer Butter Masala। कुल 540 रुपये। कैश ऑन डिलीवरी।',
};

// Plays a short sample in one of the phone's voices (the voice list on the Soundbox screen).
export async function sampleVoice(voice, language = 'en') {
    if (voice && !(await engineHasVoices())) voice = null;
    try {
        Speech.stop();
        speaking = true;   // let the voice finish, then the keep-alive plays again (voiceDone)
        Speech.speak(SAMPLE[language] || SAMPLE.en, {
            language: voice?.language || (language === 'hi' ? 'hi-IN' : 'en-IN'),
            ...(voice ? { voice: voice.identifier } : {}),
            rate: 0.92,
            volume: settings().volume,
            onDone: voiceDone, onStopped: voiceDone, onError: voiceDone,
        });
    } catch (e) { speaking = false; /* a missing voice is not worth an error */ }
}

// Hear the greeting followed by a sample order, in the chosen voice (the Greeting section of the Soundbox screen).
export async function previewGreeting() {
    const language = await languageToUse();
    const g = sampleGreeting(language);
    return speak(g + ' ' + SAMPLE[language], language);
}

async function speak(text, language) {
    const voice = await pickVoice(language);
    return new Promise((resolve) => {
        let done = false;
        const finish = (how) => {
            if (done) return;
            done = true;
            note('voice ' + how);
            voiceDone();
            resolve();
        };
        speaking = true;
        note('voice starts (' + (voice ? voiceLabel(voice).name : 'default voice') + ')');
        try {
            Speech.stop();
            Speech.speak(text, {
                language: voice?.language || (language === 'hi' ? 'hi-IN' : 'en-IN'),
                ...(voice ? { voice: voice.identifier } : {}),
                rate: 0.92,
                volume: settings().volume,
                onStart: () => note('voice is speaking'),
                onDone: () => finish('finished'),
                onStopped: () => finish('stopped'),
                onError: (e) => finish('FAILED: ' + (e?.message || e?.code || 'error')),
            });
        } catch (e) { finish('FAILED: ' + e.message); return; }
        setTimeout(() => finish('timed out'), SPEECH_TIMEOUT_MS);
    });
}

// The name said for "Call me: My name": the one typed on the Soundbox screen, else the one on his account.
const nameToSay = () => (settings().ownerName || '').trim() || useAuthStore.getState().user?.name || '';

// His account's name, filled in once so "My name" works without typing it again. The account may have no name at all
// (a shop owner is added by phone number only); then he types it on the Soundbox screen.
async function fillOwnerName() {
    if ((settings().ownerName || '').trim()) return;
    try {
        const { data } = await api.get('/me');
        const name = String(data?.name || '').trim();
        if (name && !(settings().ownerName || '').trim()) useSoundboxStore.getState().update({ ownerName: name.slice(0, 30) });
    } catch (e) { /* the greeting says "sir" until he types a name */ }
}

// The owner's greeting as he set it on the Soundbox screen (Call me and / or the greeting of his faith), or '' for none.
function greetingText(language) {
    const s = settings();
    return buildGreeting({ language, greetFaith: s.greetFaith, callMe: s.callMe, addressAs: s.addressAs, name: nameToSay() });
}

// the greeting in front of a sentence
function withGreeting(text, language) {
    const g = greetingText(language);
    return g ? g + ' ' + text : text;
}

// what the greeting sounds like right now (the Soundbox screen's preview)
export function sampleGreeting(language = settings().language) {
    return greetingText(language) || (language === 'hi' ? 'नमस्ते' : 'Hello');
}

// the sentence of one waiting order in the language being used
const textOf = (entry, language) => (language === 'hi'
    ? (entry.speechHi || 'ऑर्डर ' + (entry.orderNo || '') + ' इंतज़ार कर रहा है।')
    : (entry.speech || 'New order ' + (entry.orderNo || '') + ' is waiting.'));

/* ------------------------------ the loop ------------------------------ */
function firstPending() {
    const it = pending.entries().next();
    return it.done ? null : it.value[1];
}

// The rounds are timed here, with the wall clock, and the audio player is only the CLOCK TICK. React Native stops its
// JavaScript timers while the app is in the background (the screen is off), but the player keeps reporting its position
// about twice a second, so each report is a chance to check the time.
//
//   bell  - the bell plays (the alert track starts with it, then silence that keeps the player and the app alive)
//   voice - once the bell is over the order is read out; the player may be paused by the voice meanwhile
//   gap   - the voice has FINISHED: wait one "repeat every", counted from that moment, then ring the bell again.
//           So the bell can never cut into the voice, whatever the repeat time and however long the order is.
const CHIME_S = 1.8;
const VOICE_GUARD_MS = 25000;   // the voice is taken as finished after this, whatever the speech engine said
let phase = 'off';              // off | bell | voice | gap
let roundStartAt = 0;
let nextBellAt = 0;
let voiceStartAt = 0;

function resetClock() { phase = 'off'; }

function startRound() {
    phase = 'bell';
    roundStartAt = Date.now();
    note('bell');
    try { player?.seekTo(0); player?.play(); } catch (e) { /* ignore */ }
}

function endVoice() {
    if (phase !== 'voice') return;
    phase = 'gap';
    // the wait is counted from the moment the voice FINISHED: "repeat every 10 s" = 10 s of quiet, then the bell again
    nextBellAt = Date.now() + Math.max(5, settings().repeatSec) * 1000;
}

function onClock(status) {
    if (!looping || !wantPlaying || !status?.playing || phase === 'off') return;
    const now = Date.now();
    if (phase === 'bell') {
        if (now - roundStartAt >= CHIME_S * 1000 && !speaking) { phase = 'voice'; voiceStartAt = now; speakRound(); }
    } else if (phase === 'voice') {
        if (!speaking || now - voiceStartAt > VOICE_GUARD_MS) { speaking = false; endVoice(); }
    } else if (phase === 'gap') {
        if (now >= nextBellAt && !speaking) startRound();
    }
}

// What one round says: the first waiting order (with the greeting, once), then how many more are waiting.
async function speakRound() {
    const next = firstPending();
    const s = settings();
    if (!next || !isOwner() || !s.soundbox || speaking) { endVoice(); return; }   // Soundbox off: no voice at all
    speaking = true;   // from now until the voice has finished, no clock tick may take the voice as done or ring the bell
    // Ask the server whether this order is still waiting. One that was accepted, cancelled or is already out for delivery
    // (the update never reached this phone) must never be read out as a new order again.
    const firstId = pending.keys().next().value;
    if (firstId && firstId !== 'test-push') {
        try {
            const o = await Promise.race([fetchOrder(firstId), new Promise((r) => setTimeout(() => r(null), 3000))]);   // a slow network must not hold the voice back
            if (o && o.status !== 'placed') { note('order ' + (o.orderNo || firstId) + ' is no longer waiting: dropped'); speaking = false; dismiss(firstId); endVoice(); return; }
        } catch (e) { /* offline: read it as before */ }
    }
    note('round' + (AppState.currentState !== 'active' ? ' (app in background)' : ''));
    const language = await languageToUse();
    const more = pending.size - 1;
    const tail = language === 'hi'
        ? 'और ' + more + ' ऑर्डर इंतज़ार कर रहे हैं।'
        : more + ' more ' + (more === 1 ? 'order is' : 'orders are') + ' waiting.';
    let text = more > 0 ? textOf(next, language) + ' ' + tail : textOf(next, language);
    if (!next.greeted) { next.greeted = true; text = withGreeting(text, language); }   // the greeting is said once per order, not on every repeat
    await speak(text, language);
    endVoice();   // the voice has finished: the next bell comes after the gap
}

// Backup clock for when the app is open. The player's own reports can stop (the bell track ended and the player sat paused:
// "player was paused: playing again" and then nothing), and the round would never reach the voice. JavaScript timers run
// fine while the app is open; with the screen off the player's reports are still the clock, as before.
let backupClock = null;
function startBackupClock() {
    if (backupClock) return;
    backupClock = setInterval(() => { if (AppState.currentState === 'active') onClock({ playing: true }); }, 500);
}
function stopBackupClock() { if (backupClock) { clearInterval(backupClock); backupClock = null; } }

function kick() {
    if (looping || !pending.size) return;
    looping = true;
    startBackupClock();
    setRinging(true);
    ensureAudio().then(() => { if (looping) setTrack('alert'); });   // the chime loop starts; the audio then clocks the rounds
}

function stopLoop() {
    looping = false;
    stopBackupClock();
    setRinging(false);
    resetClock();
    try { Speech.stop(); } catch (e) { /* ignore */ }
    // "Always ready": back to the silent keep-alive. Otherwise everything stops, and the notification goes away.
    if (keepAliveWanted()) setTrack('idle');
    else if (player) setTrack('off');
}

/* ------------------------------ orders waiting ------------------------------ */
export function raise({ orderId, orderNo, speech, speechHi, autoAccepted }) {
    // Soundbox off = the owner wants no new-order sound at all: no chime, no voice, no greeting
    note('new-order message received' + (orderNo ? ' (' + orderNo + ')' : ''));
    if (!orderId || !isOwner() || !settings().soundbox) { note('ignored: ' + (!isOwner() ? 'not an owner' : !settings().soundbox ? 'Soundbox is off' : 'no order id')); return; }
    // Not "always ready" and the app is in the background: the PUSH rings and reads this order (clip, then the order once).
    // Starting a repeating alert from the background would need the permanent notification this mode exists to avoid.
    if (!settings().alwaysReady && AppState.currentState !== 'active') { note('ignored: app in background and Always ready is off'); return; }
    const id = String(orderId);
    if (acked.has(id)) { note('ignored: you already opened this order'); return; }
    if (autoAccepted) { acked.add(id); announceAuto({ orderNo, speech, speechHi }); return; }   // the shop accepts it by itself: told once, no ringing
    const isNew = !pending.has(id);
    if (isNew) note('order ' + (orderNo || id) + ' arrived');
    pending.set(id, { orderNo, speech, speechHi });
    if (isNew) { stopLoop(); kick(); } else kick();   // a new order starts a fresh round at once
}

// An order the shop accepted BY ITSELF (auto accept): the same Soundbox, but once: the "accepted" chime, then the order read out
// (it ends with "Auto accepted"). It does not repeat, because there is nothing for the owner to press.
async function announceAuto({ orderNo, speech, speechHi }) {
    if (speaking) return;
    note('order ' + (orderNo || '') + ' accepted by itself');
    playSfx('orderAccepted');
    try {
        const language = await languageToUse();
        await new Promise((r) => setTimeout(r, 1300));   // the chime first, then the voice
        if (!speaking) await speak(withGreeting(textOf({ orderNo, speech, speechHi }, language), language), language);
    } catch (e) { /* the chime is enough */ }
}

// The order is dealt with (opened, accepted, cancelled): stop alerting for it.
export function dismiss(orderId) {
    if (!orderId) return;
    pending.delete(String(orderId));
    if (!pending.size) stopLoop();
}

// The owner opened the order himself.
export function acknowledge(orderId) {
    if (!orderId) return;
    acked.add(String(orderId));
    dismiss(orderId);
}

export function clearAll() {
    pending.clear();
    acked.clear();
    stopLoop();
}

// Tapped a "New order received" push (app was closed, in the background, or the screen was off). Soundbox mode ON:
// say the order once as the app opens. The order counts as seen, so the chime does not start again for it.
export async function speakOnOpen(data) {
    if (!isOwner() || !data?.orderId) return;
    acknowledge(data.orderId);
    if (!settings().soundbox) return;
    await ensureAudio();
    const language = await languageToUse();
    await speak(withGreeting(textOf({ orderNo: data.orderNo, speech: data.speech, speechHi: data.speechHi }, language), language), language);
}

/* ------------------------------ reading the order with the screen off ------------------------------ */
// Called by the background task (backgroundTask.js) for the server's silent data message. Nothing here is on screen: the
// app may not even be running, so the stores start empty and are read back from the phone first.
export async function speakForPush(data) {
    // The app is in front, or the running Soundbox is connected / already ringing / already talking: the live alert handles
    // this order, and a second voice from the push would mix with it.
    // The voice is ONLY for a new order (and its reminder) or a cancelled one. Any other push (no rider yet, late, ...) is never spoken.
    if (!['order_new', 'order_unaccepted_reminder', 'order_cancelled'].includes(String(data?.type))) return;
    await useSoundboxStore.getState().hydrate();
    // A connected socket only counts when the running Soundbox really rings in the background ("always ready"). Otherwise
    // raise() ignores the order and the push is the ONLY thing that can read it out.
    const liveHandles = () => AppState.currentState === 'active' || looping || speaking || (started && settings().alwaysReady && realtimeConnected());
    if (liveHandles()) return;
    if (!settings().soundbox) return;                 // Soundbox off: no voice at all

    const id = String(data?.orderId || data?.orderNo || '');
    note('order arrived with the screen off');
    // No waiting for the clip here: the server sends this message a few seconds after the notification, so the clip is over.
    // (A wait on the phone would not work: JavaScript timers stop while the screen is off, so it would only end when the
    // owner woke the phone.) Everything below is native calls and promises, which do run with the screen off.
    const language = await languageToUse();
    await pickVoice(language);   // finds the voice; wakes the speech engine if it has gone to sleep
    // the running app (Soundbox alive in the background) already rings and reads it, or the owner opened it: do not say it twice
    if ((id && data?.type !== 'order_cancelled' && (pending.has(id) || acked.has(id))) || liveHandles()) { note('already handled by the live alert'); return; }

    const text = withGreeting(textOf({ orderNo: data?.orderNo, speech: data?.speech, speechHi: data?.speechHi }, language), language);
    note('reading the order in the background');
    await speak(text, language);
}

// An order was cancelled (by the customer, the system or the rider): stop ringing for it, then a falling tone and, in
// Soundbox mode, the voice says so once. Only while the app runs; a closed app gets the normal push.
async function announceCancel(d) {
    const id = String(d.orderId);
    const wasWaiting = pending.has(id);
    dismiss(id);
    if (!isOwner() || !settings().soundbox || speaking) return;
    if (!settings().alwaysReady && AppState.currentState !== 'active' && !wasWaiting) return;
    note('order ' + (d.orderNo || id) + ' cancelled');
    playSfx('orderCancelled');
    try {
        const language = await languageToUse();
        const no = d.orderNo || '';
        // the server sends the whole sentence (who cancelled, the dishes, the total, how it was paid); the short one is the fallback
        const full = language === 'hi' ? d.speechHi : d.speech;
        const text = full || (language === 'hi'
            ? 'ऑर्डर ' + no + ' रद्द हो गया।'
            : 'Order ' + no + ' was cancelled' + (d.byRider ? ' by the delivery partner.' : '.'));
        await new Promise((r) => setTimeout(r, 1300));   // the tone first, then the voice
        if (!speaking) await speak(text, language);
    } catch (e) { /* the tone is enough */ }
}

// A customer at a table asked for the bill: a short tone, then the voice says it two times ("Table 7 asked for the bill"). Only while
// the app runs (in front, or Soundbox "always ready"); a closed app gets the normal notification.
async function announceBill(d) {
    if (!isOwner() || !settings().soundbox || speaking) return;
    if (!settings().alwaysReady && AppState.currentState !== 'active') return;
    const table = String(d?.table || '');
    if (!table) return;
    note('table ' + table + ' asked for the bill');
    try {
        const language = await languageToUse();
        const text = language === 'hi' ? 'टेबल ' + table + ' ने बिल मांगा है।' : 'Table ' + table + ' asked for the bill.';
        await speak(text, language);
        await new Promise((res) => setTimeout(res, 700));
        await speak(text, language);
    } catch (e) { /* the notification is enough */ }
}

// A guest calls the waiter, or asks for water...: the voice says it once (same rules as announceBill).
const CALL_EN = { waiter: 'is calling the waiter', water: 'needs water', cutlery: 'needs a spoon or a plate', clean: 'needs the table cleaned', other: 'needs help' };
const CALL_HI = { waiter: 'वेटर को बुला रहा है', water: 'को पानी चाहिए', cutlery: 'को चम्मच या प्लेट चाहिए', clean: 'की सफाई चाहिए', other: 'को मदद चाहिए' };
async function announceCall(d) {
    if (!isOwner() || !settings().soundbox || speaking) return;
    if (!settings().alwaysReady && AppState.currentState !== 'active') return;
    const table = String(d?.table || '');
    if (!table) return;
    note('table ' + table + ' called: ' + d?.what);
    try {
        const language = await languageToUse();
        const what = d?.what in CALL_EN ? d.what : 'other';
        await speak(language === 'hi' ? 'टेबल ' + table + ' ' + CALL_HI[what] + '।' : 'Table ' + table + ' ' + CALL_EN[what] + '.', language);
    } catch (e) { /* the notification is enough */ }
}

/* ------------------------------ catching up ------------------------------ */
// Orders that are still waiting for the owner. Runs when the app opens or the socket comes back, so an order that
// arrived while nothing was listening is not missed.
async function syncWaiting() {
    if (!isOwner()) return;
    try {
        const r = await fetchOrders({ status: 'placed', limit: 20 });
        const ids = new Set();
        for (const o of r.items || []) {
            ids.add(String(o._id || o.id));
            raise({ orderId: o._id || o.id, orderNo: o.orderNo, speech: o.speech, speechHi: o.speechHi });
        }
        // anything we were ringing for that is no longer "placed"
        for (const id of [...pending.keys()]) if (!ids.has(id)) dismiss(id);
    } catch (e) { /* offline: the socket and the push still work */ }
}

/* ------------------------------ Soundbox mode: stay alive ------------------------------ */
// Should the app stay alive in the background with its permanent notification? Only when Soundbox is on AND "always ready" is.
const keepAliveWanted = () => !!settings().soundbox && !!settings().alwaysReady && isOwner();

async function holdAlive(on) {
    try {
        if (on) {
            await ensureAudio();
            activateKeepAwakeAsync(WAKE_TAG).catch(() => { });
            setTrack(looping ? 'alert' : 'idle');
        } else {
            wantPlaying = false;
            deactivateKeepAwake(WAKE_TAG);
            if (player) {
                try { { lockScreenOn = false; player.setActiveForLockScreen?.(false); } } catch (e) { /* ignore */ }
                try { player.pause(); } catch (e) { /* ignore */ }
            }
        }
    } catch (e) { /* the alert still works while the app is open */ }
}

/* ------------------------------ start / stop ------------------------------ */
function begin() {
    if (started) return;
    started = true;
    useSoundboxStore.getState().hydrate().then(() => {
        holdAlive(keepAliveWanted());
        syncWaiting();
        fillOwnerName();
    });

    unsubs.push(onNotification((n) => {
        if (n?.type === 'order_cancelled' && n.data?.orderId) { announceCancel(n.data); return; }
        if (n?.type === 'table_bill_asked') { announceBill(n.data); return; }
        if (n?.type === 'table_call') { announceCall(n.data); return; }
        if (!n || !ALERT_TYPES.includes(n.type)) return;
        const d = n.data || {};
        raise({ orderId: d.orderId, orderNo: d.orderNo, speech: d.speech, speechHi: d.speechHi, autoAccepted: !!d.autoAccepted });
    }));

    unsubs.push(onOrderUpdate((p) => {
        // somebody dealt with it (this phone, another owner phone, the customer, the timeout job)
        if (p?.orderId && p.status && p.status !== 'placed') dismiss(p.orderId);
        // a brand new order: the live notification above rings. This catches a missed message.
        else if (p?.orderId && p.status === 'placed') syncWaiting();
    }));

    const sub = AppState.addEventListener('change', (s) => { note('app is ' + s); if (s === 'active') syncWaiting(); });
    unsubs.push(() => sub.remove());

    // the settings changed on the Soundbox screen
    unsubs.push(useSoundboxStore.subscribe((st, prev) => {
        if (st.soundbox !== prev.soundbox) {
            holdAlive(keepAliveWanted());
            if (!st.soundbox) clearAll();      // switched off: whatever is ringing stops now
            else syncWaiting();                // switched on: ring for the orders that are still waiting
        } else if (st.alwaysReady !== prev.alwaysReady) {
            // the permanent notification appears or goes away at once (an alert that is ringing right now is left alone)
            if (!looping) holdAlive(keepAliveWanted());
            else if (!keepAliveWanted()) { /* it ends with the alert: stopLoop() then stops everything */ }
        }
        // the volume or the chime switch changed while it is ringing: apply it now, without starting the round again
        // (the repeat time is read when the voice finishes, so it needs nothing)
        if (st.soundbox && looping && player && (st.volume !== prev.volume || st.ring !== prev.ring)) {
            try { player.volume = st.ring ? st.volume : 0; } catch (e) { /* ignore */ }
        }
    }));
}

function end() {
    if (!started) return;
    started = false;
    unsubs.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    unsubs = [];
    clearAll();
    holdAlive(false);
}

// Call once at start-up (App.js). Follows login and logout: only an owner (role "admin") has a Soundbox.
let wired = false;
export function startSoundbox() {
    if (wired) return;
    wired = true;
    const sync = () => (isOwner() ? begin() : end());
    useAuthStore.subscribe((st, prev) => { if (st.user?.role !== prev.user?.role || !!st.user !== !!prev.user) sync(); });
    sync();
}
