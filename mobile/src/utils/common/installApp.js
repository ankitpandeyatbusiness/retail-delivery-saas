// "Get the app" on the WEBSITE. Two ways, whichever the shop has:
//   1. the Play Store address (the server sends it as channel.getAppUrl once the shop has a published app), or
//   2. installing the website itself as an app (a PWA): Chrome / Edge / Android give an install prompt, iPhone Safari needs Share > Add to Home Screen.
// Nothing here does anything in the phone app.
import { Platform, Linking } from 'react-native';
import { create } from 'zustand';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { themedAlert } from '../../components/common/dialog';
import { tr } from '../../i18n';

const web = Platform.OS === 'web' && typeof window !== 'undefined';

// the browser offers the install prompt ONCE, early: it must be caught and kept until the person taps the button
let deferred = null;
export const useInstallStore = create(() => ({ available: false, installed: false }));

if (web) {
    window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e; useInstallStore.setState({ available: true }); });
    window.addEventListener('appinstalled', () => { deferred = null; useInstallStore.setState({ available: false, installed: true }); });
}

export const isStandalone = () => {
    if (!web) return false;
    try { return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; } catch (e) { return false; }
};
export const isIos = () => {
    if (!web) return false;
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

// what the button does, and whether to show it at all
//   { show, kind: 'store' | 'install' | 'ios', open() }
export function useGetApp() {
    const storeUrl = useHomeStore((s) => s.channel && s.channel.getAppUrl);
    const available = useInstallStore((s) => s.available);
    const installed = useInstallStore((s) => s.installed);
    if (!web || installed || isStandalone()) return { show: false };
    if (storeUrl) return { show: true, kind: 'store', open: () => Linking.openURL(storeUrl).catch(() => { }) };
    if (available) {
        return {
            show: true, kind: 'install',
            open: async () => {
                if (!deferred) return;
                try { deferred.prompt(); await deferred.userChoice; } catch (e) { /* the person closed it */ }
                deferred = null; useInstallStore.setState({ available: false });
            },
        };
    }
    if (isIos()) {
        return {
            show: true, kind: 'ios',
            open: () => themedAlert(tr('Add to your Home Screen'), tr('Tap the Share button in Safari, then "Add to Home Screen". The app opens from your Home Screen like any other app.'), [{ text: tr('OK') }], { icon: 'phone-portrait-outline' }),
        };
    }
    return { show: false };   // a browser that cannot install, and no store address yet: nothing to offer
}
