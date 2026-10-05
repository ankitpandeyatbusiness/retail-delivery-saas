import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useThemeStore } from '../../store/useThemeStore';

export default function OfferCard({ offer }) {
    const primary = useThemeStore((s) => s.theme.colors.primary);
    return (
        <View style={[styles.card, { borderColor: primary }]}>
            <Text style={[styles.code, { color: primary }]}>{offer.code}</Text>
            {offer.description ? <Text style={styles.desc} numberOfLines={2}>{offer.description}</Text> : null}
        </View>
    );
}

const styles = StyleSheet.create({
    card: { width: 190, marginRight: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', backgroundColor: '#FFFFFF' },
    code: { fontSize: 14, fontWeight: '800', letterSpacing: 1 },
    desc: { marginTop: 4, fontSize: 12, color: '#555555' },
});