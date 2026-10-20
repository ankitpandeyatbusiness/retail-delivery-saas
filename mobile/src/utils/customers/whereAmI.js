// Where the phone is right now, for the dine-in "I am at the shop" check.
// Asks for permission (again, if it was refused earlier), falls back to the last known place, and never waits more than a few seconds.
import { Linking } from 'react-native';
import * as Location from 'expo-location';

const within = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);

// returns { at } on success, or { problem: 'denied' | 'blocked' | 'off' | 'none' }
export async function whereAmI() {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted') perm = await Location.requestForegroundPermissionsAsync();
    if (perm.status !== 'granted') return { problem: perm.canAskAgain === false ? 'blocked' : 'denied' };
    try { if (!(await Location.hasServicesEnabledAsync())) return { problem: 'off' }; } catch { /* go on and try */ }
    let p = null;
    try { p = await within(Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), 8000); } catch { /* try the last known place */ }
    if (!p) { try { p = await Location.getLastKnownPositionAsync({ maxAge: 5 * 60 * 1000 }); } catch { /* none */ } }
    if (!p) return { problem: 'none' };
    return { at: { lat: p.coords.latitude, lng: p.coords.longitude } };
}

export const openPhoneSettings = () => Linking.openSettings().catch(() => { });
