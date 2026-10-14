import { useColorScheme } from 'react-native';
import { useThemeStore } from '../store/useThemeStore';
const palette = require('./palette');

export { palette };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };
export const radius = { sm: 10, md: 14, lg: 20, xl: 28, pill: 999 };
export const font = { xs: 12, sm: 13, md: 15, lg: 17, xl: 22, xxl: 28, hero: 32 };
export const TAP = 48;   // minimum touch height

// '#RRGGBB' + 0..1  ->  '#RRGGBBAA'
export const tint = (hex, a) => `${hex}${Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, '0')}`;

const build = (dark) => {
    const s = dark ? palette.dark : palette.light;
    const st = palette.status;
    const sections = {};
    for (const [name, [a, b]] of Object.entries(palette.sections)) {
        sections[name] = { color: b, light: a, gradient: [a, b], soft: tint(b, dark ? 0.22 : 0.13) };
    }
    const c = (light, darkc) => (dark ? darkc : light);
    return {
        dark,
        ...s,
        primary: dark ? palette.brand.primaryDark : palette.brand.primary,
        onPrimary: '#FFFFFF',
        primarySoft: tint(palette.brand.primary, dark ? 0.24 : 0.12),
        gradient: palette.brand.gradient,

        success: c(st.success, st.successDark), successSoft: tint(st.success, dark ? 0.22 : 0.13),
        warn: c(st.warn, st.warnDark), warnSoft: tint(st.warn, dark ? 0.22 : 0.14),
        danger: c(st.danger, st.dangerDark), dangerSoft: tint(st.danger, dark ? 0.24 : 0.12),
        info: c(st.info, st.infoDark), infoSoft: tint(st.info, dark ? 0.22 : 0.12),

        sections,
        // soft coloured shadow under cards (iOS) + elevation (Android)
        shadow: {
            shadowColor: palette.brand.primary,
            shadowOpacity: dark ? 0 : 0.1,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 6 },
            elevation: dark ? 0 : 2,
        },
    };
};

const LIGHT = build(false);
const DARK = build(true);

export const useTheme = () => {
    const system = useColorScheme();
    const mode = useThemeStore((s) => s.mode);
    const dark = mode === 'system' ? system === 'dark' : mode === 'dark';
    return dark ? DARK : LIGHT;
};

// colours of one area ('orders', 'money'...). Unknown names fall back to the brand.
export const section = (t, name) => t.sections[name] || { color: t.primary, light: t.gradient[0], gradient: [t.gradient[0], t.gradient[1]], soft: t.primarySoft };
