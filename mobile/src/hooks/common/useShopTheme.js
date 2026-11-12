// The shop's theme AS THE WEBSITE ON A COMPUTER SHOULD DRAW IT. The server sends the mobile look in the theme and, in theme.desk, the look of the desktop website
// (equal to the mobile one while the shop's desktop look "follows the Mobile App UI", its own values otherwise: colours, light and dark theme, header, top bar,
// categories, filter popup, location bar). On a wide browser window those values replace the mobile ones; on the phone, a phone-sized browser and in the app the
// theme is returned exactly as it is, so nothing there changes.
import { useMemo } from 'react';
import { useThemeStore } from '../../store/common/useThemeStore';
import { useIsDesktopWeb } from '../../utils/common/layout';

const KEYS = ['lightLook', 'darkLook', 'headerStyle', 'tabBarStyle', 'categoryStyle', 'categoryScroll', 'filterStyle', 'locationStyle'];

export function lookOf(theme, desktop) {
    const d = theme && theme.desk;
    if (!desktop || !d) return theme;
    const out = { ...theme };
    KEYS.forEach((k) => { if (d[k] !== undefined && d[k] !== null) out[k] = d[k]; });
    if (d.lightLook) out.look = d.lightLook;   // (the old single field follows the light theme)
    if (d.colors && Object.keys(d.colors).length) out.colors = d.colors;
    return out;
}

export function useShopTheme() {
    const theme = useThemeStore((s) => s.theme);
    const desktop = useIsDesktopWeb();
    return useMemo(() => lookOf(theme, desktop), [theme, desktop]);
}
