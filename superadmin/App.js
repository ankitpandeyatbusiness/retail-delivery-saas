import React, { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import RootNavigator from './src/navigation/RootNavigator';
import { ToastHost, toast } from './src/components/feedback';
import LegalGate from './src/components/LegalGate';
import LockGate from './src/lock/LockUI';
import { useSupreme } from './src/hooks/useSupreme';
import { useAuthStore } from './src/store/useAuthStore';
import { useThemeStore } from './src/store/useThemeStore';
import { useInboxStore } from './src/store/useInboxStore';
import { configurePush, enablePush, startPushTaps } from './src/utils/push';
import { navigationRef, flushPending, handleBack } from './src/navigation/ref';
import { fetchMe } from './src/api/authApi';
import { useTheme } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => { });

// the panel's lock: every superadmin may switch it on; the supreme admin (money, settlements, agreements) must have it. Signing out is the way out of a forgotten PIN.
function PanelLock() {
    const id = useAuthStore((s) => (s.token ? (s.admin?._id || s.admin?.id || s.admin?.email || 'admin') : null));
    const supreme = useSupreme();
    return <LockGate uid={id} required={supreme} onSignOut={() => useAuthStore.getState().logout()} />;
}

function Shell() {
    const t = useTheme();
    const hydrated = useAuthStore((s) => s.hydrated);

    useEffect(() => { useThemeStore.getState().hydrate(); useAuthStore.getState().hydrate(); }, []);
    useEffect(() => { if (hydrated) SplashScreen.hideAsync().catch(() => { }); }, [hydrated]);
    // the phone window behind the app (seen above the keyboard) follows the screen colour, never the splash colour
    useEffect(() => { SystemUI.setBackgroundColorAsync(t.bg).catch(() => { }); }, [t.bg]);

    const token = useAuthStore((st) => st.token);
    useEffect(() => {
        if (!token) return undefined;
        configurePush();
        startPushTaps();                         // tapping a help-request alert opens that request
        enablePush({ ask: false });              // registers this phone only if alerts are already allowed
        useInboxStore.getState().refresh();
        // a stale token is found out here (the client logs out on 401), and the name stays current
        fetchMe().then((me) => useAuthStore.setState((st) => ({ admin: { ...(st.admin || {}), ...me } }))).catch(() => { });
        const id = setInterval(() => useInboxStore.getState().refresh(), 60000);
        return () => clearInterval(id);
    }, [token]);

    // Android Back: see handleBack in navigation/ref.js
    useEffect(() => {
        if (Platform.OS !== 'android') return undefined;
        const sub = BackHandler.addEventListener('hardwareBackPress', () => handleBack(() => toast('Press back again to exit')));
        return () => sub.remove();
    }, []);

    if (!hydrated) return null;   // the splash stays up until the saved login is read
    const base = t.dark ? DarkTheme : DefaultTheme;
    return (
        <NavigationContainer ref={navigationRef} onReady={flushPending} theme={{ ...base, colors: { ...base.colors, background: t.bg, card: t.surface, text: t.text, border: t.border, primary: t.primary } }}>
            <RootNavigator />
            <LegalGate />
            <PanelLock />
            <ToastHost />
        </NavigationContainer>
    );
}

export default function App() {
    return (
        <SafeAreaProvider>
            <Shell />
        </SafeAreaProvider>
    );
}
