// The customer's address on a tracking map: a red pin with a white ring, a house in it, a shadow, and a point at the bottom.
// Used as the child of a <Marker anchor={{ x: 0.5, y: 1 }}> so the point sits exactly on the address.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// label: a short text above the pin (for example the order number), in the same colour
export default function HomePin({ color = '#E53935', size = 38, label }) {
    return (
        <View style={{ width: Math.max(size + 14, label ? 64 : 0), height: size + 24 + (label ? 20 : 0), alignItems: 'center' }}>
            {label ? <View style={[s.label, { borderColor: color }]}><Text style={[s.labelText, { color }]} numberOfLines={1}>{label}</Text></View> : null}
            <View style={[s.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
                <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name="home" size={Math.round(size * 0.52)} color="#FFFFFF" />
                </View>
            </View>
            <View style={[s.point, { borderTopColor: '#FFFFFF' }]} />
            <View style={[s.pointInner, { borderTopColor: color }]} />
        </View>
    );
}

const s = StyleSheet.create({
    label: { backgroundColor: '#FFFFFF', borderWidth: 1.5, borderRadius: 9, paddingHorizontal: 6, paddingVertical: 1, marginBottom: 2, elevation: 4 },
    labelText: { fontSize: 11, fontWeight: '900' },
    ring: { backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', elevation: 6, shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },
    point: { width: 0, height: 0, borderLeftWidth: 9, borderRightWidth: 9, borderTopWidth: 14, borderLeftColor: 'transparent', borderRightColor: 'transparent', marginTop: -3 },
    pointInner: { position: 'absolute', bottom: 3, width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 10, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
});
