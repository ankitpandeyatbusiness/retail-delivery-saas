import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';

export default function PriceText({ price, mrp }) {
    const color = useThemeStore((s) => s.theme.colors.text);
    return (
        <View style={styles.row}>
            <Text style={[styles.price, { color }]}>₹{price}</Text>
            {mrp > price ? <Text style={styles.mrp}>₹{mrp}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    price: { fontSize: 16, fontWeight: '700' },
    mrp: { marginLeft: 8, fontSize: 13, color: '#999999', textDecorationLine: 'line-through' },
});