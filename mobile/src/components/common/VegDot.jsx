import React from 'react';
import { View, StyleSheet } from 'react-native';

export default function VegDot({ isVeg }) {
    const color = isVeg ? '#0F8A3C' : '#B3261E';
    return (
        <View style={[styles.box, { borderColor: color }]}>
            <View style={[styles.dot, { backgroundColor: color }]} />
        </View>
    );
}

const styles = StyleSheet.create({
    box: {
        width: 16, height: 16, borderWidth: 1.5, borderRadius: 3,
        alignItems: 'center', justifyContent: 'center', marginRight: 6,
    },
    dot: { width: 8, height: 8, borderRadius: 4 },
});