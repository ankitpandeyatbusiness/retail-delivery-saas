// Keeps the store of the live delivery up to date. Mount ONCE (LiveOrderHost does).
//
//   1. finds the customer's delivery that is out_for_delivery (and again when any order changes, or the app comes back)
//   2. joins its socket room and listens: rider:location, rider:route, order:eta, rider:quiet
//   3. the polling fallback: when the socket is down, or the server asked for polling (busy), the tracking page is fetched every
//      pollSec seconds instead; with a healthy socket it is fetched only now and then as a safety net
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useLiveTripStore } from '../../store/customers/useLiveTripStore';
import { fetchOrders, fetchTracking } from '../../api/customers/shopApi';
import { onRiderLocation, onRiderRoute, onOrderEta, onRiderQuiet, onOrderUpdate, onNotification, watchOrder, getTrackingMode, realtimeConnected } from '../../api/common/socket';

const SAFETY_SEC = 40;

export function useLiveTrip(enabled) {
    const user = useAuthStore((s) => s.user);
    const orderId = useLiveTripStore((s) => s.orderId);
    const busy = useRef(false);

    // 1. which order is on the way
    useEffect(() => {
        if (!enabled || !user) { useLiveTripStore.getState().reset(); return undefined; }
        let dead = false;
        const find = async () => {
            if (busy.current) return;
            busy.current = true;
            try {
                const r = await fetchOrders({ active: true, limit: 5 });
                if (dead) return;
                const o = (r.items || []).find((x) => x.orderType === 'delivery' && x.status === 'out_for_delivery');
                const cur = useLiveTripStore.getState().orderId;
                if (!o) { if (cur) useLiveTripStore.getState().reset(); return; }
                if (String(o.id || o._id) !== String(cur)) useLiveTripStore.getState().reset(String(o.id || o._id), o.orderNo);
            } catch (e) { /* the bar simply stays as it was */ } finally { busy.current = false; }
        };
        find();
        const a = onOrderUpdate(find);
        const b = onNotification((n) => { if (n?.data?.orderId) find(); });
        const c = AppState.addEventListener('change', (st) => { if (st === 'active') find(); });
        return () => { dead = true; a(); b(); c.remove(); };
    }, [enabled, user]);

    // 2 + 3. the live data of that order
    useEffect(() => {
        if (!orderId) return undefined;
        const id = String(orderId);
        const st = useLiveTripStore.getState();
        const leave = watchOrder(id);
        const load = () => fetchTracking(id).then((t) => {
            if (useLiveTripStore.getState().orderId !== id) return;
            if (t.state === 'delivered' || t.state === 'cancelled' || t.state === 'undelivered') useLiveTripStore.getState().reset();
            else useLiveTripStore.getState().setTrack(t);
        }).catch(() => { });
        load();
        const mine = (p) => String(p?.orderId) === id;
        const offs = [
            onRiderLocation((p) => { if (mine(p) && typeof p.lat === 'number') st.setLoc(p); }),
            onRiderRoute((p) => { if (mine(p)) st.setRoute({ polyline: p.polyline, distanceM: p.distanceM, durationSec: p.durationSec, source: p.source }); }),
            onOrderEta((p) => { if (mine(p)) st.setEta({ etaAt: p.etaAt, remainingM: p.remainingM, remainingSec: p.remainingSec, source: p.source }); }),
            onRiderQuiet((p) => { if (mine(p)) st.setQuiet(true); }),
            onOrderUpdate((p) => { if (mine(p)) load(); }),
        ];
        // one small timer decides whether the page is due: often when the socket cannot be used, rarely when it works
        const tick = setInterval(() => {
            const m = getTrackingMode();
            const live = realtimeConnected() && m.mode === 'socket';
            const every = (live ? SAFETY_SEC : Math.max(5, m.pollSec || 15)) * 1000;
            if (Date.now() - useLiveTripStore.getState().lastDataAt >= every) load();
        }, 5000);
        return () => { leave(); offs.forEach((f) => f()); clearInterval(tick); };
    }, [orderId]);
}
