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
import { startSoundbox } from './src/utils/owners/soundbox';
import { applyTypography } from './src/components/common/typography';
import { useBrand } from './src/components/common/kit';
import { useLang, syncLanguage } from './src/i18n';
import { installTextTranslation } from './src/i18n/textPatch';

// The native splash screen (brand colour + logo) is the only loading screen. It stays up until the shop's look
// and the saved login are ready, then fades out into the app: no black screen, no second spinner.
// This must run at module level, before the first render.
installTextTranslation();   // texts that are not wrapped in tr() are still translated when the language has them
SplashScreen.preventAutoHideAsync().catch(() => { });
try { SplashScreen.setOptions({ duration: 350, fade: true }); } catch (e) { /* older native build */ }

const MAX_WAIT_MS = 3000;   // never keep the splash longer than this waiting for the network
const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(r, ms))]);

export default function App() {
  const [isReady, setIsReady] = useState(false);
  const lang = useLang((st) => st.lang);   // a new language redraws the whole app (the key below)
  const background = useBrand().background;   // follows the look that is actually drawn (shop look, or the customer's Appearance choice)

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const theme = useThemeStore.getState();
        await theme.hydrateFromCache();   // the last look, from disk: instant
        await Promise.all([
          useAuthStore.getState().hydrate(),                  // saved login, from SecureStore
          useLang.getState().hydrate(),                       // the saved language (or the phone's)
          withTimeout(theme.loadTheme(), MAX_WAIT_MS),        // fresh look; a slow network does not hold the app
        ]);
        // the shop's font (classic / rounded, or modern in the new looks): loaded before the first frame so text never changes font
        const look = useThemeStore.getState().theme;
        await withTimeout(applyTypography(look.fontStyle, look.lightLook || look.look), MAX_WAIT_MS);
      } catch (e) { /* both helpers swallow their own errors; open the app anyway */ }
      if (alive) setIsReady(true);
    })();
    // the server learns the language after every login (so notifications and emails come in it)
    const unsubLang = useAuthStore.subscribe((st, prev) => { if (st.user && !prev.user) syncLanguage(); });
    syncLanguage();
    startRealtime();        // live order updates while a customer is logged in
    startNotifications();   // push, unread badge, open the order from a notification
    startSoundbox();        // the shop owner's new-order alert (does nothing for customers and riders)
    return () => { alive = false; unsubLang(); };
  }, []);

  // hide the splash only after the first real frame is laid out, so there is never a blank flash in between
  const onLayout = useCallback(() => { SplashScreen.hideAsync().catch(() => { }); }, []);

  if (!isReady) return null;   // the native splash is still covering the screen

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: background }} onLayout={onLayout}>
      <SafeAreaProvider>
        <SheetHost key={lang}>
          <AppNavigator />
        </SheetHost>
        {/* after the host so alerts (e.g. "Delete address?") draw above the sheet */}
        <DialogHost />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
