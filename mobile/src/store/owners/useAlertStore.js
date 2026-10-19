// Whether the new-order alert is ringing right now (an order is waiting and the Soundbox is repeating it).
// The Soundbox engine sets it; the screens read it, so "Play" and "Stop" can show what is really happening.
import { create } from 'zustand';

// riderAttention: a rider cancelled, reported a problem or pressed help since the owner last opened the Riders tab (it blinks)
export const useAlertStore = create(() => ({ ringing: false, riderAttention: false }));
export const setRiderAttention = (on) => useAlertStore.setState({ riderAttention: !!on });
export const setRinging = (ringing) => useAlertStore.setState({ ringing: !!ringing });
