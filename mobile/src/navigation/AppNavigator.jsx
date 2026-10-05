import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import HomeScreen from '../screens/HomeScreen';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';

const Stack = createNativeStackNavigator();
const navigationRef = createNavigationContainerRef();

export default function AppNavigator() {
    const isHydrated = useAuthStore((s) => s.isHydrated);
    const user = useAuthStore((s) => s.user);
    const hydrate = useAuthStore((s) => s.hydrate);
    const hadUser = useRef(false);

    // 1) On app start: restore the saved session from SecureStore
    useEffect(() => {
        hydrate();
    }, [hydrate]);

    useEffect(() => {
        useThemeStore.getState().loadTheme();
    }, []);

    // 2) If a signed-in user becomes signed-out (logout, or the refresh token
    //    was rejected), send them back to Login. Guests who tapped "Skip" never
    //    had a user, so they are not affected.
    useEffect(() => {
        if (!isHydrated) return;
        if (hadUser.current && !user && navigationRef.isReady()) {
            navigationRef.resetRoot({ index: 0, routes: [{ name: 'Login' }] });
        }
        hadUser.current = !!user;
    }, [isHydrated, user]);

    // Don't render any screen until we know whether a session exists,
    // otherwise a logged-in user would see the Login screen flash.
    if (!isHydrated) {
        return (
            <View style={{ flex: 1, backgroundColor: '#111111', alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#FFFFFF" />
            </View>
        );
    }

    return (
        <NavigationContainer ref={navigationRef}>
            <Stack.Navigator
                screenOptions={{ headerShown: false }}
                initialRouteName={user ? 'MainTabs' : 'Login'}
            >
                {/* Both stay registered so LoginScreen's Skip / goToMain keep working */}
                <Stack.Screen name="Login" component={LoginScreen} />
                <Stack.Screen name="MainTabs" component={HomeScreen} />
            </Stack.Navigator>
        </NavigationContainer>
    );
}