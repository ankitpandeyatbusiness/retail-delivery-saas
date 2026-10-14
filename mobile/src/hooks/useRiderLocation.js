// Sends the rider's phone location to the server while he has an order in progress.
// The customer's tracking map reads it (bike pin). The server saves it only while the rider has an active
// order, at most every 3 seconds, and only if the shop has live tracking on.
//
// Foreground only: it works while the app is open (or the screen is on). Sending with the app in the
// background needs a foreground service (expo-task-manager), which is not part of this build.
import { useEffect } from 'react';
import * as Location from 'expo-location';
import { sendLocation } from '../api/riderApi';

const EVERY_MS = 10000;

export function useRiderLocation(enabled) {
    useEffect(() => {
        if (!enabled) return undefined;
        let dead = false;
        let sub = null;
        (async () => {
            try {
                const p = await Location.requestForegroundPermissionsAsync();
                if (!p.granted || dead) return;
                sub = await Location.watchPositionAsync(
                    { accuracy: Location.Accuracy.Balanced, timeInterval: EVERY_MS, distanceInterval: 10 },
                    (pos) => { sendLocation(pos.coords.latitude, pos.coords.longitude).catch(() => { }); },
                );
                if (dead) sub.remove();
            } catch (e) { /* no GPS or no permission: the customer just sees no bike */ }
        })();
        return () => { dead = true; if (sub) sub.remove(); };
    }, [enabled]);
}
