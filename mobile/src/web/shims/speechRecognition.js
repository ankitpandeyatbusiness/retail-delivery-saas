// The website's stand-in for expo-speech-recognition (voice search in Search and Home). It uses the BROWSER's own speech recognition (Chrome, Edge, Safari;
// Firefox has none) and asks the browser for the microphone first, so the permission question appears (also in the installed website).
// The same event names and shapes as the phone's module: 'start', 'result' ({ results: [{ transcript }] }), 'error' ({ error }), 'end'.
import { useEffect, useRef } from 'react';

const API = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null;
const listeners = new Map();   // event name -> Set of handlers
const emit = (name, payload) => { (listeners.get(name) || []).forEach((fn) => { try { fn(payload); } catch (e) { /* a handler's own error is its own */ } }); };
let rec = null;

// asks the browser for the microphone (the question shows the first time; the answer is remembered by the browser, and by the installed website)
async function askMic() {
    try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return { granted: false, status: 'denied', canAskAgain: false, expires: 'never' };
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        return { granted: true, status: 'granted', canAskAgain: true, expires: 'never' };
    } catch (e) {
        return { granted: false, status: 'denied', canAskAgain: !(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')), expires: 'never' };
    }
}

export const ExpoSpeechRecognitionModule = {
    requestPermissionsAsync: askMic,
    getPermissionsAsync: async () => {
        try {
            const p = await navigator.permissions.query({ name: 'microphone' });
            return { granted: p.state === 'granted', status: p.state === 'granted' ? 'granted' : p.state === 'denied' ? 'denied' : 'undetermined', canAskAgain: p.state !== 'denied', expires: 'never' };
        } catch (e) { return { granted: false, status: 'undetermined', canAskAgain: true, expires: 'never' }; }
    },
    start(opts = {}) {
        if (!API) { emit('error', { error: 'not-supported', message: 'Voice search is not available in this browser' }); emit('end'); return; }
        if (typeof window !== 'undefined' && window.isSecureContext === false) { emit('error', { error: 'not-allowed', message: 'Voice search needs a secure (https) address' }); emit('end'); return; }
        try { if (rec) rec.abort(); } catch (e) { /* already stopped */ }
        const r = new API();
        r.lang = opts.lang || 'en-IN';
        r.interimResults = !!opts.interimResults;
        r.continuous = !!opts.continuous;
        r.maxAlternatives = 1;
        r.onstart = () => emit('start');
        r.onresult = (e) => {
            const res = e.results && e.results[e.results.length - 1];
            const alt = res && res[0];
            emit('result', { results: [{ transcript: (alt && alt.transcript) || '', confidence: alt && alt.confidence }], isFinal: !!(res && res.isFinal) });
        };
        r.onerror = (e) => emit('error', { error: e.error, message: e.message });
        r.onend = () => emit('end');
        rec = r;
        try { r.start(); } catch (e) { emit('error', { error: 'start-failed', message: e && e.message }); emit('end'); }
    },
    stop() { try { if (rec) rec.stop(); } catch (e) { /* already stopped */ } },
    abort() { try { if (rec) rec.abort(); } catch (e) { /* already stopped */ } },
    isRecognitionAvailable: () => !!API,
};

export function useSpeechRecognitionEvent(name, handler) {
    const ref = useRef(handler);
    ref.current = handler;
    useEffect(() => {
        const fn = (p) => ref.current(p);
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name).add(fn);
        return () => { listeners.get(name).delete(fn); };
    }, [name]);
}
