// Calls `reload` whenever the server says this order changed (status, rider accepted, ...).
// Also listens to the customer's inbox messages that mention the order, because some changes only arrive that way.
import { useEffect, useRef } from 'react';
import { onOrderUpdate, onNotification, watchOrder } from '../../api/common/socket';

export function useOrderLive(orderId, reload) {
    const ref = useRef(reload);
    ref.current = reload;

    useEffect(() => {
        if (!orderId) return undefined;
        const id = String(orderId);
        const leave = watchOrder(id);
        const off1 = onOrderUpdate((p) => { if (String(p?.orderId) === id) ref.current(); });
        const off2 = onNotification((n) => { if (String(n?.data?.orderId) === id) ref.current(); });
        return () => { leave(); off1(); off2(); };
    }, [orderId]);
}

// For the orders list: reload when any of this customer's orders changes.
export function useAnyOrderLive(reload) {
    const ref = useRef(reload);
    ref.current = reload;

    useEffect(() => {
        const a = onOrderUpdate(() => ref.current());
        const b = onNotification((n) => { if (n?.data?.orderId) ref.current(); });
        return () => { a(); b(); };
    }, []);
}
