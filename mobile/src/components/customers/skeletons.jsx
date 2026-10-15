// src/components/customers/skeletons.jsx
// Placeholders that have the exact SHAPE of what is loading, so the screen builds up instead of popping in.
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useBrand } from '../common/kit';
import { Skel } from '../common/motion';

export function SkelCats({ style = 'circles', count = 5 }) {
    const items = Array.from({ length: count });
    return (
        <View style={s.catRow}>
            {items.map((_, i) => {
                if (style === 'tiles') return <Skel key={i} width={84} height={100} radius={18} style={s.catGap} />;
                if (style === 'pills') return <Skel key={i} width={104} height={40} radius={20} style={s.catGap} />;
                return (
                    <View key={i} style={[s.circleWrap, s.catGap]}>
                        <Skel width={62} height={62} radius={31} />
                        <Skel width={48} height={10} radius={5} style={{ marginTop: 8 }} />
                    </View>
                );
            })}
        </View>
    );
}

export function SkelBanner() {
    return <Skel height={170} radius={24} style={{ marginHorizontal: 16, marginVertical: 8 }} />;
}

// one dish card, in the shop's card style
export function SkelDish({ variant = 'big' }) {
    const { surface, border } = useBrand();
    if (variant === 'compact') {
        return (
            <View style={[s.compact, { backgroundColor: surface, borderColor: border }]}>
                <View style={{ flex: 1, paddingRight: 12 }}>
                    <Skel width="70%" height={15} />
                    <Skel width="40%" height={12} style={{ marginTop: 10 }} />
                    <Skel width="30%" height={14} style={{ marginTop: 14 }} />
                </View>
                <Skel width={112} height={104} radius={16} />
            </View>
        );
    }
    if (variant === 'grid') {
        return (
            <View style={s.pair}>
                {[0, 1].map((i) => (
                    <View key={i} style={[s.grid, { backgroundColor: surface, borderColor: border }]}>
                        <Skel height={120} radius={0} />
                        <View style={{ padding: 10 }}>
                            <Skel width="75%" height={13} />
                            <Skel width="35%" height={12} style={{ marginTop: 10 }} />
                        </View>
                    </View>
                ))}
            </View>
        );
    }
    return (
        <View style={[s.big, { backgroundColor: surface, borderColor: border }]}>
            <Skel height={190} radius={0} />
            <View style={s.bigBody}>
                <View style={{ flex: 1 }}>
                    <Skel width="60%" height={16} />
                    <Skel width="35%" height={12} style={{ marginTop: 10 }} />
                    <Skel width="25%" height={16} style={{ marginTop: 12 }} />
                </View>
                <Skel width={84} height={34} radius={12} />
            </View>
        </View>
    );
}

export function SkelFeed({ variant = 'big', count = 3 }) {
    return (
        <View>
            <View style={s.secHead}><Skel width={150} height={18} /></View>
            {Array.from({ length: count }).map((_, i) => <SkelDish key={i} variant={variant} />)}
        </View>
    );
}

const s = StyleSheet.create({
    catRow: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12 },
    catGap: { marginRight: 10 },
    circleWrap: { width: 72, alignItems: 'center' },
    secHead: { paddingHorizontal: 16, paddingTop: 20, paddingBottom: 10 },
    big: { marginHorizontal: 16, marginBottom: 18, borderRadius: 22, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
    bigBody: { flexDirection: 'row', alignItems: 'center', padding: 14 },
    compact: { flexDirection: 'row', marginHorizontal: 16, marginBottom: 16, padding: 14, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth },
    pair: { flexDirection: 'row', paddingHorizontal: 10 },
    grid: { flex: 1, margin: 6, borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
});
