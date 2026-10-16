// The navigator's handle, so code outside the screens (a tapped push alert) can open a screen.
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

let pending = null;   // a screen to open as soon as the navigator is ready (the app was closed when the alert was tapped)

export function openScreen(name, params) {
    if (!navigationRef.isReady()) { pending = { name, params }; return; }
    navigationRef.navigate(name, params);
}
export function flushPending() {
    if (pending) { const p = pending; pending = null; openScreen(p.name, p.params); }
}
