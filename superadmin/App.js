import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import * as SplashScreen from 'expo-splash-screen';
import RootNavigator from './src/navigation/RootNavigator';
import { ToastHost } from './src/components/feedback';
import { useAuthStore } from './src/store/useAuthStore';
import { useThemeStore } from './src/store/useThemeStore';
import { useInboxStore } from './src/store/useInboxStore';
import { configurePush, enablePush } from './src/utils/push';
import { fetchMe } from './src/api/authApi';
import { useTheme } from './src/theme';

SplashScreen.preventAutoHideAsync().catch(() => { });

function Shell() {
    const t = useTheme();
    const hydrated = useAuthStore((s) => s.hydrated);

    useEffect(() => { useThemeStore.getState().hydrate(); useAuthStore.getState().hydrate(); }, []);
    useEffect(() => { if (hydrated) SplashScreen.hideAsync().catch(() => { }); }, [hydrated]);

    const token = useAuthStore((st) => st.token);
    useEffect(() => {
        if (!token) return undefined;
        configurePush();
        enablePush({ ask: false });              // registers this phone only if alerts are already allowed
        useInboxStore.getState().refresh();
        // a stale token is found out here (the client logs out on 401), and the name stays current
        fetchMe().then((me) => useAuthStore.setState((st) => ({ admin: { ...(st.admin || {}), ...me } }))).catch(() => { });
        const id = setInterval(() => useInboxStore.getState().refresh(), 60000);
        return () => clearInterval(id);
    }, [token]);

    if (!hydrated) return null;   // the splash stays up until the saved login is read
    const base = t.dark ? DarkTheme : DefaultTheme;
    return (
        <NavigationContainer theme={{ ...base, colors: { ...base.colors, background: t.bg, card: t.surface, text: t.text, border: t.border, primary: t.primary } }}>
            <RootNavigator />
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
