// The one delivery that is on its way to this customer, kept live. Read by the floating bar and the map sheet.
//   sheet: 'bar' (only the small bar) | 'half' | 'full'
import { create } from 'zustand';

const EMPTY = { orderId: null, orderNo: null, track: null, loc: null, route: null, eta: null, dest: null, quiet: false, lastDataAt: 0 };

export const useLiveTripStore = create((set) => ({
    ...EMPTY,
    sheet: 'bar',
    liveOffset: 0,   // how much room the delivery bar (or its small chip) takes above the tabs, so the active-order bar can sit above it
    setLiveOffset: (liveOffset) => set((s) => (s.liveOffset === liveOffset ? s : { liveOffset })),
    barH: 0,   // room the floating active-order bar takes above the tabs (0 when it is not shown)
    setBarH: (barH) => set((s) => (s.barH === barH ? s : { barH })),
    setSheet: (sheet) => set({ sheet }),
    // a different (or no) order: forget the old one completely
    reset: (orderId = null, orderNo = null) => set({ ...EMPTY, orderId, orderNo, sheet: 'bar' }),
    setTrack: (track) => set((s) => ({
        track,
        loc: track?.riderLocation ? { lat: track.riderLocation.lat, lng: track.riderLocation.lng, heading: track.riderLocation.heading ?? null, at: track.riderLocation.at } : s.loc,
        route: track?.route || s.route,
        eta: track?.etaAt ? { etaAt: track.etaAt, remainingM: track.remaining?.meters ?? s.eta?.remainingM ?? null, remainingSec: track.remaining?.seconds ?? s.eta?.remainingSec ?? null, source: track.etaSource } : s.eta,
        dest: track?.destination || s.dest,
        quiet: !!track?.riderQuiet,
        lastDataAt: Date.now(),
    })),
    setLoc: (p) => set((s) => ({
        loc: { lat: p.lat, lng: p.lng, heading: p.heading ?? s.loc?.heading ?? null, at: p.at },
        quiet: false, lastDataAt: Date.now(),
    })),
    setRoute: (route) => set({ route }),
    setEta: (eta) => set({ eta, lastDataAt: Date.now() }),
    setQuiet: (quiet) => set({ quiet }),
}));

// The bottom padding of a customer tab screen: a normal 24, plus the room of the floating bar while one is on screen.
export const useBottomSpace = () => useLiveTripStore((s) => 24 + Math.max(s.liveOffset, s.barH));
