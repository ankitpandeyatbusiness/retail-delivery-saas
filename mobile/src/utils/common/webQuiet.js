// The website's console (and the terminal that `expo start --web` mirrors it to) only needs real problems. These dev messages are always the same and never
// need action, so they are not printed: the web build has no native animation module (animations fall back to JavaScript, which is fine), the React
// DevTools hint, and react-native-web's start-up lines. Everything else, every real warning and error, is printed as before. Nothing happens in the phone app.
import { Platform } from 'react-native';

const QUIET = [
    'useNativeDriver',                      // "Animated: `useNativeDriver` is not supported because the native animated module is missing"
    'Download the React DevTools',
    'Running application "',
    'Development-level warnings',
    'Performance optimizations',
    'Listening to push token changes',
];
const quiet = (args) => { const a = args[0]; return typeof a === 'string' && QUIET.some((q) => a.includes(q)); };

export function quietWebConsole() {
    if (Platform.OS !== 'web' || typeof console === 'undefined' || console.__quiet) return;
    ['log', 'info', 'warn'].forEach((k) => {
        const orig = console[k] && console[k].bind(console);
        if (!orig) return;
        console[k] = (...args) => { if (!quiet(args)) orig(...args); };
    });
    console.__quiet = true;
}
