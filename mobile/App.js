import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './src/navigation/AppNavigator';
import { useThemeStore } from './src/store/useThemeStore';

export default function App() {
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    // loadTheme never throws: on failure the fallback theme stays
    useThemeStore.getState().loadTheme().finally(() => setIsReady(true));
  }, []);

  // Short blank screen while the theme downloads, so the shop name never flashes wrong
  if (!isReady) {
    return (
      <View style={{ flex: 1, backgroundColor: '#111111', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color="#FFFFFF" />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AppNavigator />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}