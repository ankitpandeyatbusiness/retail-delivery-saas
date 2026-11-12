// WEB ONLY: pull the page down to refresh, on a phone's browser or the installed PWA, on every screen.
// Pulling down from the top of a page (when nothing under the finger can scroll up any more) shows a round spinner; letting go runs the refresh of the
// screen that is open (the one that has a RefreshControl: see src/web/shims/refreshControl.js), or, on a screen that has none, reloads the page.
// Nothing happens on a computer with a mouse, inside text boxes, or in the phone app (no document there).
import { Platform } from 'react-native';

const stack = [];
export function registerRefresh(fn) {
    stack.push(fn);
    return () => { const i = stack.indexOf(fn); if (i >= 0) stack.splice(i, 1); };
}

const NEED = 78;   // how far the page is pulled, in pixels, before letting go refreshes

const scrollsUp = (el) => {
    for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
        const oy = n.nodeType === 1 ? getComputedStyle(n).overflowY : '';
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight && n.scrollTop > 0) return true;
    }
    return window.scrollY > 0;
};

export function installPullRefresh() {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || window.__pullRefresh) return;
    window.__pullRefresh = true;
    const st = document.createElement('style');
    st.textContent = 'html,body{overscroll-behavior-y:contain}';
    document.head.appendChild(st);

    const dot = document.createElement('div');
    dot.setAttribute('style', 'position:fixed;left:50%;top:0;width:40px;height:40px;margin-left:-20px;border-radius:20px;background:#fff;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:2147483000;display:none;align-items:center;justify-content:center;pointer-events:none;font:700 18px sans-serif;color:#444');
    document.body.appendChild(dot);
    const spin = document.createElement('style');
    spin.textContent = '@keyframes ptr{to{transform:rotate(360deg)}}';
    document.head.appendChild(spin);
    const show = (y, busy) => {
        dot.style.display = 'flex';
        dot.style.transform = `translateY(${Math.max(y, 0) - 48}px)`;
        dot.innerHTML = busy ? '<div style="width:20px;height:20px;border:3px solid #ddd;border-top-color:#444;border-radius:50%;animation:ptr .7s linear infinite"></div>' : `<span style="display:inline-block;transform:rotate(${Math.min(y / NEED, 1) * 180}deg)">↓</span>`;
    };
    const hide = () => { dot.style.display = 'none'; };

    let y0 = 0, x0 = 0, on = false, pull = 0, busy = false;
    document.addEventListener('touchstart', (e) => {
        on = false; pull = 0;
        if (busy || e.touches.length !== 1) return;
        const el = e.target;
        if (el && el.closest && el.closest('input,textarea,select,[contenteditable],[data-no-pull]')) return;
        if (scrollsUp(el)) return;
        y0 = e.touches[0].clientY; x0 = e.touches[0].clientX; on = true;
    }, { passive: true });
    document.addEventListener('touchmove', (e) => {
        if (!on) return;
        const dy = e.touches[0].clientY - y0;
        const dx = Math.abs(e.touches[0].clientX - x0);
        if (dy < 0 || dx > dy) { on = false; hide(); return; }
        if (scrollsUp(e.target)) { on = false; hide(); return; }
        pull = Math.min(dy * 0.5, NEED * 1.4);
        if (pull > 8) show(pull, false);
    }, { passive: true });
    const done = async () => {
        if (!on) return;
        on = false;
        if (pull < NEED) { hide(); return; }
        busy = true; show(NEED * 0.7, true);
        const run = stack[stack.length - 1];
        try {
            if (run) await Promise.race([Promise.resolve(run()), new Promise((r) => setTimeout(r, 6000))]);
            else { window.location.reload(); return; }
        } catch (err) { /* the screen shows its own error */ }
        setTimeout(() => { busy = false; hide(); }, 500);
    };
    document.addEventListener('touchend', done, { passive: true });
    document.addEventListener('touchcancel', () => { on = false; hide(); }, { passive: true });
}
