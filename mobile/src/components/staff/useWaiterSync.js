// Keeps the waiter's floor fresh for as long as a waiter is signed in, on any tab: loads at once, again when the server says something
// changed (socket), when the app comes back to the front, and every 20 seconds as a safety net. Several signals close together make one load.
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { onWaiterUpdate } from '../../api/common/socket';
import { useWaiterStore } from '../../store/staff/useWaiterStore';
import { staffAlert } from '../../utils/staff/staffSound';

export default function useWaiterSync(on) {
    useEffect(() => {
        if (!on) return undefined;
        const store = useWaiterStore;
        let timer = null;
        const soon = () => { clearTimeout(timer); timer = setTimeout(() => store.getState().load(), 250); };
        store.getState().load();
        const off = onWaiterUpdate((p) => { if (p?.alert) staffAlert(p.alert); soon(); });
        const app = AppState.addEventListener('change', (st) => { if (st === 'active') soon(); });
        const every = setInterval(() => { if (AppState.currentState === 'active') store.getState().load(); }, 20000);
        return () => { off(); app.remove(); clearInterval(every); clearTimeout(timer); };
    }, [on]);
}
