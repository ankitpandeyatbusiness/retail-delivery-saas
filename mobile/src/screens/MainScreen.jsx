import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useThemeStore } from '../store/useThemeStore';
import { useAuthStore } from '../store/useAuthStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function MainScreen({ navigation }) {
    const { theme } = useThemeStore();
    const { user, logout } = useAuthStore();
    const insets = useSafeAreaInsets();

    const handleLogout = async () => {
        await logout();
        navigation.replace('Login');
    };

    return (
        <View style={[styles.container, { paddingTop: insets.top, backgroundColor: theme.colors.background }]}>
            <Text style={[styles.title, { color: theme.colors.primary }]}>Welcome to {theme.name}!</Text>
            <Text style={[styles.subtitle, { color: theme.colors.text }]}>Logged in as: +91 {user?.phone}</Text>

            <Pressable onPress={handleLogout} style={[styles.button, { backgroundColor: theme.colors.error }]}>
                <Text style={styles.buttonText}>Log Out</Text>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
    title: { fontSize: 28, fontWeight: 'bold', marginBottom: 12 },
    subtitle: { fontSize: 16, marginBottom: 40 },
    button: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
    buttonText: { color: '#FFF', fontWeight: '600' }
});