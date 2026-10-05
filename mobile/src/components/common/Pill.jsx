import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';

function Pill({ label, active, onPress }) {
    const primary = useThemeStore((s) => s.theme.colors.primary);
    return (
        <Pressable
            onPress={onPress}
            style={[styles.pill, active && { backgroundColor: primary, borderColor: primary }]}
        >
            <Text style={[styles.text, active && styles.textActive]}>{label}</Text>
        </Pressable>
    );
}

export default React.memo(Pill);

const styles = StyleSheet.create({
    pill: {
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 18,
        borderWidth: 1,
        borderColor: '#DDDDDD',
        backgroundColor: '#FFFFFF',
        marginRight: 8,
    },
    text: { fontSize: 13, fontWeight: '600', color: '#333333' },
    textActive: { color: '#FFFFFF' },
});