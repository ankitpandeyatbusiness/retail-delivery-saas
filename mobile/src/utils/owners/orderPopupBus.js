// Tells the order popup (components/owners/NewOrderPopup.jsx) to show one order: a tap on a new-order or cancelled-order notification does this.
// If the popup is not there yet (the app was closed when the notification was tapped), the request waits for it.
const listeners = new Set();
let waiting = null;

export function showOrderPopup(orderId, kind) {
    if (!orderId) return;
    if (!listeners.size) { waiting = { orderId: String(orderId), kind }; return; }
    listeners.forEach((fn) => { try { fn(String(orderId), kind); } catch (e) { /* the others still hear it */ } });
}

export function onShowOrderPopup(fn) {
    listeners.add(fn);
    if (waiting) { const w = waiting; waiting = null; setTimeout(() => fn(w.orderId, w.kind), 600); }
    return () => listeners.delete(fn);
}
