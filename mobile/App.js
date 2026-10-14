import React, { useCallback, useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as SplashScreen from 'expo-splash-screen';
import AppNavigator from './src/navigation/AppNavigator';
import { useThemeStore } from './src/store/common/useThemeStore';
import { useAuthStore } from './src/store/common/useAuthStore';
import { DialogHost } from './src/components/common/dialog';
import { SheetHost } from './src/components/common/SheetPortal';
import { startRealtime } from './src/api/common/socket';
import { startNotifications } from './src/utils/common/push';

// The native splash screen (brand colour + logo) is the only loading screen. It stays up until the shop's look
// and the saved login are ready, then fades out into the app: no black screen, no second spinner.
// This must run at module level, before the first render.
SplashScreen.preventAutoHideAsync().catch(() => { });
try { SplashScreen.setOptions({ duration: 350, fade: true }); } catch (e) { /* older native build */ }

const MAX_WAIT_MS = 3000;   // never keep the splash longer than this waiting for the network
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const background = useThemeStore((s) => s.theme.colors?.background) || '#FFFFFF';

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const theme = useThemeStore.getState();
        await theme.hydrateFromCache();   // the last look, from disk: instant
        await Promise.all([
          useAuthStore.getState().hydrate(),                  // saved login, from SecureStore
          withTimeout(theme.loadTheme(), MAX_WAIT_MS),        // fresh look; a slow network does not hold the app
        ]);
      } catch (e) { /* both helpers swallow their own errors; open the app anyway */ }
      if (alive) setIsReady(true);
    })();
    startRealtime();        // live order updates while a customer is logged in
    startNotifications();   // push, unread badge, open the order from a notification
    return () => { alive = false; };
  }, []);

  // hide the splash only after the first real frame is laid out, so there is never a blank flash in between
  const onLayout = useCallback(() => { SplashScreen.hideAsync().catch(() => { }); }, []);

  if (!isReady) return null;   // the native splash is still covering the screen

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }} onLayout={onLayout}>
      <SafeAreaProvider>
        <SheetHost>
          <AppNavigator />
        </SheetHost>
        {/* after the host so alerts (e.g. "Delete address?") draw above the sheet */}
        <DialogHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
