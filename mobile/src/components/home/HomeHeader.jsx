import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';
import ProfileButton from './ProfileButton';

export default function HomeHeader() {
    const name = useThemeStore((s) => s.theme.name);
    const color = useThemeStore((s) => s.theme.colors.text);
    return (
        <View style={styles.row}>
            <View>
                <Text style={styles.hint}>Ordering from</Text>
                <Text style={[styles.name, { color }]}>{name}</Text>
            </View>
            <ProfileButton />
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 10 },
    hint: { fontSize: 12, color: '#888888' },
    name: { fontSize: 20, fontWeight: '800' },
});