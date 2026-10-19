// The navigator's handle, so code outside the screens (a tapped push alert) can open a screen.
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

let pending = null;   // a screen to open as soon as the navigator is ready (the app was closed when the alert was tapped)

export function openScreen(name, params) {
    if (!navigationRef.isReady()) { pending = { name, params }; return; }
    navigationRef.navigate(name, params);
}
// Android back button: pages go back one by one (the navigator does it), any other tab goes back to Home, and on Home the first
// Back says "Press back again to exit" and a second one within 2 seconds leaves the app.
let lastBack = 0;
export function handleBack(onFirst) {
    if (!navigationRef.isReady()) return false;
    if (navigationRef.canGoBack()) return false;   // a page or another tab is open: the navigator goes back
    const now = Date.now();
    if (now - lastBack < 2000) return false;       // second press: the phone closes the app
    lastBack = now;
    onFirst();
    return true;
}

export function flushPending() {
    if (pending) { const p = pending; pending = null; openScreen(p.name, p.params); }
}
