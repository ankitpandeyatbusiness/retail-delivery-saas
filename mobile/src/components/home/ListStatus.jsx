import React from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';

export default function ListStatus({ loading, error, onRetry }) {
    const primary = useThemeStore((s) => s.theme.colors.primary);
    if (loading) return <ActivityIndicator style={styles.box} color={primary} />;
    return (
        <View style={styles.box}>
            <Text style={styles.text}>{error || 'No items found'}</Text>
            {error ? (
                <Pressable onPress={onRetry}>
                    <Text style={[styles.retry, { color: primary }]}>Try again</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    box: { padding: 32, alignItems: 'center' },
    text: { fontSize: 14, color: '#777777' },
    retry: { marginTop: 10, fontSize: 14, fontWeight: '700' },
});