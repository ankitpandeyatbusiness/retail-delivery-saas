// While a guest has an open table bill and the app is open, tell the shop once a minute that the phone is here and whether its location is on. The shop uses it
// only to keep a quiet eye on a guest who still owes (services/guestWatch.js). It asks for nothing and never shows anything: a phone that cannot report is simply
// "not heard from".
import { useEffect } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { reportPresence } from '../../api/customers/shopApi';

async function locationNow() {
    try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') return 'off';
        return (await Location.hasServicesEnabledAsync()) ? 'on' : 'off';
    } catch (e) { return 'unknown'; }
}

export default function useTablePresence() {
    const customer = useAuthStore((s) => s.user?.role === 'customer');
    const open = useTableBill((s) => !!s.bill?.open);
    useEffect(() => {
        if (!customer || !open) return undefined;
        const send = async () => { if (AppState.currentState === 'active') reportPresence(await locationNow()).catch(() => { }); };
        send();
        const t = setInterval(send, 60000);
        const a = AppState.addEventListener('change', (st) => { if (st === 'active') send(); });
        return () => { clearInterval(t); a.remove(); };
    }, [customer, open]);
}
