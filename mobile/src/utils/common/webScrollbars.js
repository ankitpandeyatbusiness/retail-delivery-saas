// The desktop website (a window at least 1024 px wide) shows no scrollbars anywhere: lists and pages still scroll with the wheel, the trackpad, the keyboard
// and by touch; only the bar is hidden. The same rule is in public/index.html; this copy is added from the app itself, so it also works when the page's
// template was cached or an older one is served. Nothing happens in the phone app (no document there) or when the rule is already in the page.
import { Platform } from 'react-native';

const CSS = `@media (min-width: 1024px) {
  * { scrollbar-width: none; -ms-overflow-style: none; }
  *::-webkit-scrollbar { display: none; width: 0; height: 0; }
}`;

// a text box that has the cursor keeps its own look: no white outline from the browser around it (injected on its own, so it applies even when the page template already has the scrollbar rule)
const FOCUS_CSS = 'input:focus, textarea:focus, select:focus, [contenteditable]:focus { outline: none !important; }';

export function hideWebScrollbars() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (!document.getElementById('no-focus-outline')) {
        const fx = document.createElement('style');
        fx.id = 'no-focus-outline';
        fx.textContent = FOCUS_CSS;
        document.head.appendChild(fx);
    }
    if (document.getElementById('no-scrollbars') || document.getElementById('no-scrollbars-app')) return;
    const el = document.createElement('style');
    el.id = 'no-scrollbars-app';
    el.textContent = CSS;
    document.head.appendChild(el);
}
