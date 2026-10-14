/*
 * THE ONE FILE THAT DEFINES EVERY COLOUR OF RETAIL CONTROL.
 *
 * Change a value here and the whole app follows: screens, buttons, tiles, icons, status pills.
 * The app icon and splash are drawn from these same values, so after a change run:
 *
 *     npm run logo        (regenerates assets/icon.png, adaptive icon and splash from this file)
 *
 * Only hex colours (#RRGGBB) please: soft tints are worked out from them.
 * Plain CommonJS on purpose, so both the app and the logo script can read it.
 */
module.exports = {
    // The brand: headers, primary buttons, active tab, logo background. Three stops, top-left to bottom-right.
    brand: {
        gradient: ['#7C5CFF', '#4F46E5', '#2F80ED'],
        primary: '#5B4CF0',        // single-colour uses (links, focus rings, switches)
        primaryDark: '#8F86FF',    // the same colour on a dark background
    },

    // One colour family per area of the app, so you always know where you are.
    // [light stop, deep stop] is used for icon tiles and stat tiles.
    sections: {
        shops: ['#7C5CFF', '#4F46E5'],
        orders: ['#FFA24C', '#FF6B3D'],
        money: ['#2BD99F', '#0FA968'],
        people: ['#4CC9FF', '#1F8BF2'],
        alerts: ['#FF6B8B', '#E8325A'],
        catalog: ['#FFD04A', '#FF9F1C'],
        riders: ['#2DD4BF', '#0E9F8E'],
        settings: ['#C084FC', '#8B3DEB'],
        platform: ['#7C8BFF', '#4B5BE8'],
    },

    // Meaning colours (the same in every area)
    status: {
        success: '#12A66A', successDark: '#4ADE9A',
        warn: '#D98200', warnDark: '#FFC24D',
        danger: '#E0344F', dangerDark: '#FF7A90',
        info: '#1F8BF2', infoDark: '#6CB6FF',
    },

    // The surfaces. Light and dark follow the phone's setting.
    light: {
        bg: '#F5F3FF', surface: '#FFFFFF', surfaceAlt: '#EEEAFE',
        text: '#15122E', muted: '#6B6788', border: '#E4E0F7',
        overlay: 'rgba(21,18,46,0.55)',
    },
    dark: {
        bg: '#0E0B24', surface: '#181433', surfaceAlt: '#221D45',
        text: '#F1EEFF', muted: '#A39FC4', border: '#2E2860',
        overlay: 'rgba(0,0,0,0.7)',
    },

    // The logo only (the shop awning stripes and the live badge)
    logo: { awningA: '#FFFFFF', awningB: '#FFB35C', badge: '#2BD99F' },
};
