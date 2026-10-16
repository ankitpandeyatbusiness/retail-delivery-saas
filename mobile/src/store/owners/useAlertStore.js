// Whether the new-order alert is ringing right now (an order is waiting and the Soundbox is repeating it).
// The Soundbox engine sets it; the screens read it, so "Play" and "Stop" can show what is really happening.
import { create } from 'zustand';

export const useAlertStore = create(() => ({ ringing: false }));
export const setRinging = (ringing) => useAlertStore.setState({ ringing: !!ringing });
