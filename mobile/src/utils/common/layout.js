// One rule for "is this the desktop website?": a browser (not the phone app) at least this wide.
// Phones, the phone browser and tablets keep the app's own layout, exactly as in the native app; only a wide browser window gets the desktop layout.
import { Platform, useWindowDimensions } from 'react-native';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useViewMode } from '../../store/owners/useViewMode';

export const DESKTOP_MIN_WIDTH = 1024;
export const DESKTOP_PAGE_MAX = 1240;   // the widest the desktop customer page grows (components/customers/DesktopFrame.jsx)
export const DESKTOP_PANEL = 380;       // the cart panel beside the menu

// the desktop CUSTOMER website: a wide browser and a person who is a customer or not logged in (owners, riders and staff get their own desktop screens later)
export function useCustomerDesktop() {
    const desktop = useIsDesktopWeb();
    const role = useAuthStore((s) => s.user?.role);
    const preview = useViewMode((s) => s.customerView);   // an owner looking at the customer app ("See the customer app") sees the customer website too
    return desktop && (!role || role === 'customer' || (role === 'admin' && preview));
}

// the desktop OWNER panel: a wide browser and the shop owner (not while looking at the customer app)
export function useOwnerDesktop() {
    const desktop = useIsDesktopWeb();
    const role = useAuthStore((s) => s.user?.role);
    const preview = useViewMode((s) => s.customerView);
    return desktop && role === 'admin' && !preview;
}

// the desktop COOK and WAITER panel: a wide browser and a person whose job is kitchen or waiter
export function useStaffDesktop() {
    const desktop = useIsDesktopWeb();
    const role = useAuthStore((s) => s.user?.role);
    return desktop && (role === 'kitchen' || role === 'waiter');
}

// the same question without a hook, for the stores: a browser at least this wide right now
export const isDeskNow = () => Platform.OS === 'web' && typeof window !== 'undefined' && window.innerWidth >= DESKTOP_MIN_WIDTH;

// how many cards fit across a page on a computer, so a narrow window gets fewer, wider cards instead of squeezed ones (sidebar + page margins taken off)
export function useGridCols(max = 3, min = 300, side = 272) {
    const { width } = useWindowDimensions();
    return Math.max(1, Math.min(max, Math.floor((width - side - 40) / min)));
}

export function useIsDesktopWeb() {
    const { width } = useWindowDimensions();
    return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
