import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Constants from 'expo-constants';
import AppNavigator from './src/navigation/AppNavigator';
import { useThemeStore } from './src/store/useThemeStore';

export default function App() {
  const setTheme = useThemeStore((state) => state.setTheme);

  useEffect(() => {
    // 1. Read the injected tenant ID from app.config.js
    const tenantId = Constants.expoConfig.extra?.tenantId || 'default';

    // 2. Fetch the JSON from your MongoDB backend
    // fetch(`https://api.vivyaanbusinesssystems.com/tenants/${tenantId}`)
    //   .then(res => res.json())
    //   .then(data => {
    //      3. Overwrite the store, instantly re-styling the whole app!
    //      setTheme(data.theme); 
    //   });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}