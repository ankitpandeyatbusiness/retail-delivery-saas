import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export default function RatingBadge({ rating }) {
    if (!rating) return null;
    return (
        <View style={styles.badge}>
            <Text style={styles.text}>{Number(rating).toFixed(1)} ★</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    badge: { backgroundColor: '#1E8E3E', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginRight: 8 },
    text: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});