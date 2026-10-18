// Keeps the rider's location going while he has an order on the way.
//
// It starts the foreground service (src/utils/riders/locationTask.js) when he has an order and stops it when he has none.
// The service keeps sending with the screen off or the app swiped away, so the customer's map never freezes. Asking for
// "Allow all the time" is explained first, in the rider's own words; if he refuses, it still works while the app is open.
import { useEffect } from 'react';
import { Alert, Linking } from 'react-native';
import { startRiderTracking, stopRiderTracking, restartRiderTracking, getLocationStatus } from '../../utils/riders/locationTask';

let explained = false;   // the explanation is shown once per app start, not on every order

const ask = (title, message, yes) => new Promise((resolve) => {
    Alert.alert(title, message, [
        { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
        { text: yes, onPress: () => resolve(true) },
    ], { cancelable: false });
});

export function useRiderLocation(enabled, everySec = 10) {
    useEffect(() => {
        if (!enabled) { stopRiderTracking(); return undefined; }
        let dead = false;
        (async () => {
            try {
                if (!explained) {
                    explained = true;
                    const ok = await ask(
                        'Share your location while delivering',
                        'The customer sees where you are on the map, even when your screen is off. Next, choose "Allow all the time" for this app. A small notification stays in your phone while you deliver, and it stops when you finish.',
                        'Continue',
                    );
                    if (!ok || dead) return;
                }
                const r = await startRiderTracking({ everySec });
                if (dead) return;
                if (r === 'foreground_only') {
                    const open = await ask(
                        'One more step',
                        'Your location is shared only while the app is open. To keep it going with the screen off, open Settings > Location > choose "Allow all the time". Also set Battery to "Unrestricted" for this app.',
                        'Open Settings',
                    );
                    if (open) Linking.openSettings().catch(() => { });
                }
            } catch (e) { /* no GPS or no permission: the customer just sees no bike */ }
        })();
        // leaving this screen must not stop it: the service is meant to run with the app closed. It stops by itself when the
        // server says there is no order on the way, and when he logs out.
        return () => { dead = true; };
    }, [enabled, everySec]);

    // Watchdog. The service can be "running" (its notification is up) while the phone never gave it a position, for example when
    // the first registration did not take. startRiderTracking sees "already running" and does nothing, so nobody asks again.
    // So: while he has a delivery, if no position arrived for 40 seconds, register the service again (a few times at most).
    useEffect(() => {
        if (!enabled) return undefined;
        let restarts = 0;
        let since = Date.now();
        const id = setInterval(async () => {
            try {
                const s = getLocationStatus();
                const silent = !s.fixAt || Date.now() - s.fixAt > 40000;
                if (silent && Date.now() - since > 25000 && restarts < 6) {
                    restarts += 1;
                    since = Date.now();
                    await restartRiderTracking({ everySec });
                }
            } catch (e) { /* the next check tries again */ }
        }, 15000);
        return () => clearInterval(id);
    }, [enabled, everySec]);
}
