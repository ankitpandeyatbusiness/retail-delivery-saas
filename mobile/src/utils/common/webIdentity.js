// WEBSITE only (does nothing in the phone app): the browser tab shows the SHOP, not the platform.
//   - tab icon + "add to home screen" icon: the shop's app icon, else its own logo, else the default icon from index.html
//   - tab title: the shop's name
//   - browser colour (address bar on phones): the shop's main colour
// Called whenever the shop's theme arrives (store/common/useThemeStore.js).
import { Platform } from 'react-native';

const setLink = (rel, href) => {
    let el = document.head.querySelector(`link[rel="${rel}"]`);
    if (!el) { el = document.createElement('link'); el.setAttribute('rel', rel); document.head.appendChild(el); }
    el.removeAttribute('type');
    el.setAttribute('href', href);
};
const setMeta = (name, content) => {
    let el = document.head.querySelector(`meta[name="${name}"]`);
    if (!el) { el = document.createElement('meta'); el.setAttribute('name', name); document.head.appendChild(el); }
    el.setAttribute('content', content);
};
// only an address that really loads as a picture is used (a missing file must not leave the tab with a broken icon)
const loads = (url) => new Promise((resolve) => {
    const img = new window.Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
});

let lastIcon = null;
export async function applyWebIdentity(theme) {
    if (Platform.OS !== 'web' || typeof document === 'undefined' || !theme) return;
    try {
        if (theme.name) document.title = String(theme.name);
        if (/^#[0-9a-f]{3,8}$/i.test(String(theme.colors?.primary || ''))) setMeta('theme-color', theme.colors.primary);
        for (const url of [theme.icon, theme.logo]) {
            if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) continue;
            if (url === lastIcon) return;
            if (await loads(url)) { setLink('icon', url); setLink('apple-touch-icon', url); lastIcon = url; return; }
        }
    } catch (e) { /* the default icon stays */ }
}
