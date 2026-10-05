import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AppNavigator from './src/navigation/AppNavigator';
import { useThemeStore } from './src/store/useThemeStore';
import api from './src/api/client'; // Import your new Axios client

export default function App() {
  const setTheme = useThemeStore((state) => state.setTheme);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    const fetchSDUI = async () => {
      try {
        // We don't need to pass the tenantId here because our API interceptor 
        // automatically reads it from Expo Constants and adds the x-tenant-slug header!
        const response = await api.get('/tenants/theme');

        // Overwrite the Zustand store with the backend data
        setTheme(response.data);
      } catch (error) {
        console.warn('Failed to load theme from backend, using fallbacks.', error);
      } finally {
        setIsReady(true);
      }
    };

    fetchSDUI();
  }, []);

  // Show a blank loading screen for a split second while the theme downloads
  // so the user doesn't see "Savera" flash before it turns into "Burger King"
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