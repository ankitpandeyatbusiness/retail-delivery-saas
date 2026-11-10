// One rule for "is this the desktop website?": a browser (not the phone app) at least this wide.
// Phones, the phone browser and tablets keep the app's own layout, exactly as in the native app; only a wide browser window gets the desktop layout.
import { Platform, useWindowDimensions } from 'react-native';

export const DESKTOP_MIN_WIDTH = 1024;

export function useIsDesktopWeb() {
    const { width } = useWindowDimensions();
    return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
