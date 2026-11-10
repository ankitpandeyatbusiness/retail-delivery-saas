// Small pure helpers for the website's map (no browser, no Google): kept apart so they can be tested on their own.

// The phone map describes the view as a centre plus how many degrees it spans (latitudeDelta / longitudeDelta).
// Google Maps wants a zoom level: at zoom z the whole world (360 degrees) is 256 * 2^z pixels wide.
export function zoomFor(longitudeDelta, widthPx) {
    const d = Math.max(Number(longitudeDelta) || 0, 1e-6);
    const w = Math.max(Number(widthPx) || 0, 200);
    return Math.max(1, Math.min(20, Math.log2((360 * w) / (256 * d))));
}

// ...and back: the span in degrees that a zoom level shows across a box (the map's own bounds are used when available).
export function deltaFor(zoom, sizePx) {
    return (360 * Math.max(Number(sizePx) || 0, 200)) / (256 * 2 ** zoom);
}

// RN colours ('#E23744', '#E2374480', 'rgba(255,0,0,0.1)', 'transparent') -> Google wants a plain colour and a separate opacity
export function parseColor(input, fallback = '#000000') {
    const c = String(input == null ? '' : input).trim().toLowerCase();
    if (!c || c === 'transparent') return { color: fallback, opacity: 0 };
    let m = /^#([0-9a-f]{3})$/.exec(c);
    if (m) return { color: `#${m[1][0]}${m[1][0]}${m[1][1]}${m[1][1]}${m[1][2]}${m[1][2]}`, opacity: 1 };
    m = /^#([0-9a-f]{6})$/.exec(c);
    if (m) return { color: `#${m[1]}`, opacity: 1 };
    m = /^#([0-9a-f]{6})([0-9a-f]{2})$/.exec(c);
    if (m) return { color: `#${m[1]}`, opacity: Math.round((parseInt(m[2], 16) / 255) * 100) / 100 };
    m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(c);
    if (m) {
        const hex = [m[1], m[2], m[3]].map((n) => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
        return { color: `#${hex}`, opacity: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))) };
    }
    return { color: input && /^[a-z]+$/.test(c) ? c : fallback, opacity: 1 };   // a colour name
}

// lineDashPattern [dash, gap] (pixels) -> the dash symbol and spacing Google's polyline needs. null = a solid line.
export function dashSpec(pattern) {
    if (!Array.isArray(pattern) || pattern.length < 1) return null;
    const dash = Number(pattern[0]) || 0;
    const gap = Number(pattern[1] === undefined ? pattern[0] : pattern[1]) || 0;
    if (dash <= 0) return null;
    return { scale: dash / 2, repeat: `${Math.max(2, Math.round(dash + gap))}px` };
}

// edgePadding { top, right, bottom, left } (any may be missing) -> a full padding object
export function padding(p) {
    const o = p || {};
    return { top: Number(o.top) || 0, right: Number(o.right) || 0, bottom: Number(o.bottom) || 0, left: Number(o.left) || 0 };
}

// A value that moves smoothly from one position to the next (the rider's marker), like react-native-maps' AnimatedRegion.
// Listeners get { latitude, longitude } on every step.
export class AnimatedRegion {
    constructor(v = {}) {
        this.v = { latitude: 0, longitude: 0, latitudeDelta: 0, longitudeDelta: 0, ...v };
        this.listeners = new Map();
        this.seq = 0;
        this.raf = null;
        this.onDone = null;
    }
    _emit() { const { latitude, longitude } = this.v; this.listeners.forEach((fn) => { try { fn({ latitude, longitude }); } catch (e) { /* one listener must not stop the rest */ } }); }
    _cancel() { if (this.raf != null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf); this.raf = null; }
    setValue(v = {}) {
        this._cancel();
        this.v = { ...this.v, ...v };
        this._emit();
    }
    timing(cfg = {}) {
        return {
            start: (cb) => {
                this._cancel();
                const from = { latitude: this.v.latitude, longitude: this.v.longitude };
                const to = { latitude: cfg.latitude ?? from.latitude, longitude: cfg.longitude ?? from.longitude };
                const dur = Math.max(0, Number(cfg.duration) || 500);
                const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
                const t0 = now();
                const step = () => {
                    const k = dur === 0 ? 1 : Math.min(1, (now() - t0) / dur);
                    this.v = { ...this.v, latitude: from.latitude + (to.latitude - from.latitude) * k, longitude: from.longitude + (to.longitude - from.longitude) * k };
                    this._emit();
                    if (k < 1 && typeof requestAnimationFrame === 'function') this.raf = requestAnimationFrame(step);
                    else { this.raf = null; if (cb) cb({ finished: true }); }
                };
                step();
            },
            stop: () => this._cancel(),
        };
    }
    spring(cfg) { return this.timing(cfg); }
    stopAnimation() { this._cancel(); }
    addListener(fn) { this.seq += 1; const id = String(this.seq); this.listeners.set(id, fn); return id; }
    removeListener(id) { this.listeners.delete(String(id)); }
    removeAllListeners() { this.listeners.clear(); }
}
