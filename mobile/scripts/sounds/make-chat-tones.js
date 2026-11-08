// NOTE: the apps now play their own chat_sent.mp3 and chat_received.mp3 (assets/sounds). This script only made the first, original wav versions; it is not needed any more
// and its wav files are no longer used.
//
// Builds the two chat tones (original sounds, no recording needed, no dependencies):
//
//   node scripts/sounds/make-chat-tones.js assets/sounds
//
//   chat_sent.wav      a bubble bursting: a tiny click and a quick falling "plip", then a smaller one: played when you send a message while the chat is open
//   chat_received.wav  a gentle two-note ping: played when the other person's message arrives while the chat is open
// 16-bit mono, 44.1 kHz. Short on purpose (a chat tone is heard many times a day).
const fs = require('fs');
const path = require('path');

const RATE = 44100;
const outDir = process.argv[2];
if (!outDir) { console.error('usage: node make-chat-tones.js assets/sounds'); process.exit(1); }

function writeWav(file, samples) {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(RATE, 24); h.writeUInt32LE(RATE * 2, 28);
    h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
    fs.writeFileSync(file, Buffer.concat([h, data]));
}

// a note: a sine with a soft second harmonic, a quick attack and an exponential fade; the pitch may glide from f0 to f1
function note(ms, f0, f1, { gain = 0.5, decay = 9, harm = 0.25 } = {}) {
    const n = Math.round(RATE * ms / 1000);
    const out = new Float32Array(n);
    let phase = 0;
    for (let i = 0; i < n; i++) {
        const t = i / n;
        const f = f0 + (f1 - f0) * t;
        phase += (2 * Math.PI * f) / RATE;
        const attack = Math.min(1, i / (RATE * 0.004));
        const env = attack * Math.exp(-decay * t);
        out[i] = gain * env * (Math.sin(phase) + harm * Math.sin(2 * phase));
    }
    return out;
}
const concat = (...parts) => { const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; parts.forEach((p) => { out.set(p, o); o += p.length; }); return out; };
const mixAt = (base, add, at) => { add.forEach((v, i) => { if (at + i < base.length) base[at + i] += v; }); return base; };

// sent: a bubble bursting (about 190 ms). A tiny burst of noise (the skin breaking), a quick falling "plip" (the air inside), then a smaller second "plip" (the ring-out).
let seed = 7;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296 * 2 - 1; };
function click(ms, { gain = 0.5, decay = 14 } = {}) {
    const n = Math.round(RATE * ms / 1000);
    const out = new Float32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) {
        const w = rand();
        const hp = w - prev * 0.85;   // takes the low rumble out: a crisp tick
        prev = w;
        out[i] = gain * hp * Math.exp(-decay * (i / n));
    }
    return out;
}
const sent = new Float32Array(Math.round(RATE * 0.2));
mixAt(sent, click(16, { gain: 0.45, decay: 12 }), 0);
mixAt(sent, note(95, 1700, 620, { gain: 0.55, decay: 9, harm: 0.1 }), Math.round(RATE * 0.003));
mixAt(sent, note(70, 1250, 520, { gain: 0.24, decay: 10, harm: 0.1 }), Math.round(RATE * 0.085));

// received: two notes, the second a little higher, overlapping slightly so it rings (about 330 ms)
const rx = new Float32Array(Math.round(RATE * 0.34));
mixAt(rx, note(170, 880, 880, { gain: 0.45, decay: 6, harm: 0.3 }), 0);
mixAt(rx, note(230, 1175, 1175, { gain: 0.45, decay: 7, harm: 0.3 }), Math.round(RATE * 0.11));

fs.mkdirSync(outDir, { recursive: true });
writeWav(path.join(outDir, 'chat_sent.wav'), sent);
writeWav(path.join(outDir, 'chat_received.wav'), rx);
console.log('wrote chat_sent.wav and chat_received.wav in', outDir);
