// Builds the owner app's sound files from a voice recording (make-voice.ps1). No dependencies.
//
//   node scripts/sounds/make-sounds.js voice.wav assets/sounds
//
// Writes into assets/sounds:
//   new_order.wav  bell arpeggio + "New order received", once (3.5 s). Played by ANDROID for the new-order push, from
//                  res/raw. It is baked into the native app: changing it needs a rebuild, and a phone keeps the old one
//                  until the notification channel id changes (see docs/owner-soundbox.md).
//   alert_60.wav   the bell followed by a minute of silence, 16 kHz. The Soundbox restarts it on time for each round and
//                  it keeps the foreground service alive; if JavaScript were frozen it simply loops.
//   silence.wav    2 s of silence on loop: the idle keep-alive track while Soundbox mode is on.
const fs = require('fs');

const [voiceFile, outDir] = process.argv.slice(2);
if (!voiceFile || !outDir) { console.error('usage: node make-sounds.js voice.wav assets/sounds'); process.exit(1); }

/* ---- reading and writing wav (16-bit mono PCM) ---- */
function readWav(file) {
    const b = fs.readFileSync(file);
    let p = 12, fmt = null, data = null;
    while (p < b.length - 8) {
        const id = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
        if (id === 'fmt ') fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
        if (id === 'data') { data = b.subarray(p + 8, Math.min(b.length, p + 8 + size)); break; }
        p += 8 + size + (size % 2);
    }
    if (!fmt || !data) throw new Error('not a wav file: ' + file);
    if (fmt.bits !== 16) throw new Error('need 16-bit audio, got ' + fmt.bits);
    const n = Math.floor(data.length / 2 / fmt.ch);
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let c = 0; c < fmt.ch; c++) s += data.readInt16LE((i * fmt.ch + c) * 2); mono[i] = s / fmt.ch / 32768; }
    return { rate: fmt.rate, samples: mono };
}
function resample(x, from, to) {
    if (from === to) return x;
    const n = Math.round(x.length * to / from), out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i * from / to, i0 = Math.floor(t), f = t - i0; out[i] = x[i0] * (1 - f) + x[Math.min(i0 + 1, x.length - 1)] * f; }
    return out;
}
function writeWav(file, samples, rate) {
    let pk = 0; for (const s of samples) pk = Math.max(pk, Math.abs(s));
    const g = pk > 0.97 ? 0.97 / pk : 1;
    const pcm = Buffer.alloc(samples.length * 2);
    for (let i = 0; i < samples.length; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * g)) * 32767), i * 2);
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
    h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(file, Buffer.concat([h, pcm]));
    console.log(file, (samples.length / rate).toFixed(1) + 's', Math.round((44 + pcm.length) / 1024) + ' KB');
}

/* ---- the bell: a struck bell is inharmonic partials that die away at different speeds ---- */
function bell(rate, freq, durMs, vol) {
    const n = Math.round(rate * durMs / 1000), out = new Float32Array(n);
    const partials = [[1, 1.0, 3.2], [2.0, 0.45, 4.5], [2.76, 0.3, 6.5], [4.07, 0.16, 9], [5.4, 0.1, 12]];   // ratio, amplitude, decay per second
    for (const [r, a, d] of partials) {
        if (freq * r > rate / 2.3) continue;   // nothing the sample rate cannot hold
        const w = 2 * Math.PI * freq * r / rate;
        for (let i = 0; i < n; i++) out[i] += a * Math.min(1, i / (rate * 0.003)) * Math.exp(-d * i / rate) * Math.sin(w * i);
    }
    return out.map((v) => v * vol);
}
// four rising bell notes C6 E6 G6 C7, overlapping, 1.5 s in all
function arpeggio(rate) {
    const out = new Float32Array(Math.round(rate * 1.5));
    [[1046.5, 0], [1318.5, 130], [1568.0, 260], [2093.0, 390]].forEach(([f, at], k) => {
        const b = bell(rate, f, 1100, 0.55 - k * 0.04), start = Math.round(rate * at / 1000);
        for (let i = 0; i < b.length && start + i < out.length; i++) out[start + i] += b[i];
    });
    return out;
}
const silence = (rate, ms) => new Float32Array(Math.round(rate * ms / 1000));
const cat = (...a) => { const o = new Float32Array(a.reduce((s, x) => s + x.length, 0)); let p = 0; for (const x of a) { o.set(x, p); p += x.length; } return o; };

/* ---- the voice: trimmed, and as loud as the bell ---- */
function prepareVoice(rate) {
    const v = readWav(voiceFile);
    let x = resample(v.samples, v.rate, rate);
    let a = 0, z = x.length - 1;
    while (a < z && Math.abs(x[a]) < 0.01) a++;
    while (z > a && Math.abs(x[z]) < 0.01) z--;
    x = x.slice(Math.max(0, a - Math.round(rate * 0.03)), Math.min(x.length, z + Math.round(rate * 0.06)));
    let pk = 0; for (const s of x) pk = Math.max(pk, Math.abs(s));
    return x.map((s) => s * (0.95 / (pk || 1)));
}

fs.mkdirSync(outDir, { recursive: true });

// new_order.wav (22.05 kHz): bell, "New order received", once
{
    const R = 22050;
    writeWav(`${outDir}/new_order.wav`, cat(arpeggio(R), silence(R, 150), prepareVoice(R), silence(R, 450)), R);
}
// alert_60.wav (16 kHz): the bell, then silence up to one minute
{
    const R = 16000;
    const arp = arpeggio(R);
    writeWav(`${outDir}/alert_60.wav`, cat(arp, silence(R, 60000 - 1000 * arp.length / R)), R);
}
// silence.wav (8 kHz): 2 s
writeWav(`${outDir}/silence.wav`, silence(8000, 2000), 8000);
