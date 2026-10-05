import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import VegDot from '../common/VegDot';
import { useThemeStore } from '../../store/useThemeStore';

export default function ItemTitle({ item, showDot }) {
    const color = useThemeStore((s) => s.theme.colors.text);
    return (
        <View style={styles.row}>
            {showDot ? <VegDot isVeg={item.isVeg} /> : null}
            <Text style={[styles.name, { color }]} numberOfLines={1}>{item.name}</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center' },
    name: { flex: 1, fontSize: 16, fontWeight: '700' },
});