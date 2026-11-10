import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../theme';
import { Card, Button } from './ui';
import { SkeletonBar } from './blocks';
import Icon from './Icon';
import { fetchReadiness } from '../api/insightsApi';
import { FIX_SCREEN } from '../utils/setupFlow';

// What the card last said for each shop: opening the same shop again shows it at once, with no loading and no jump.
const LAST = new Map();

// "Set-up 8 of 12": what is still missing on this shop, each line opens where it is fixed. Hidden when everything is done.
// While it is loading for the first time it shows a grey shimmer of the same size, so nothing below it jumps when the answer arrives.
export default function SetupCard({ shopId, name }) {
    const t = useTheme();
    const nav = useNavigation();
    const [d, setD] = useState(LAST.get(shopId) || null);
    const [failed, setFailed] = useState(false);
    useFocusEffect(useCallback(() => { fetchReadiness(shopId).then((r) => { LAST.set(shopId, r); setD(r); setFailed(false); }).catch(() => setFailed(true)); }, [shopId]));
    if (!d && failed) return null;
    if (!d) {
        return (
            <Card style={{ marginTop: spacing.md }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <SkeletonBar width="55%" height={18} />
                    <SkeletonBar width={52} height={14} />
                </View>
                <SkeletonBar height={6} radiusPx={3} style={{ marginTop: spacing.sm }} />
                {[0, 1, 2].map((i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm }}>
                        <SkeletonBar width={18} height={18} radiusPx={9} />
                        <View style={{ flex: 1, marginLeft: spacing.sm }}>
                            <SkeletonBar width="60%" height={14} />
                            <SkeletonBar width="85%" height={10} style={{ marginTop: 6 }} />
                        </View>
                    </View>
                ))}
                <SkeletonBar height={34} radiusPx={10} style={{ marginTop: spacing.sm }} />
            </Card>
        );
    }
    if (d.passed >= d.total) return null;
    const missing = d.checks.filter((c) => !c.ok);
    const fix = (c) => { const sc = FIX_SCREEN[c.key]; if (sc) nav.navigate(sc, { shopId, name }); };
    return (
        <Card style={{ marginTop: spacing.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }}>Set-up: {d.passed} of {d.total} done</Text>
                <Pressable onPress={() => nav.navigate('ShopReadiness', { shopId, name })} hitSlop={8}><Text style={{ color: t.primary, fontWeight: '700' }}>See all</Text></Pressable>
            </View>
            <View style={{ height: 6, borderRadius: 3, backgroundColor: t.surfaceAlt, marginTop: spacing.sm, overflow: 'hidden' }}>
                <View style={{ height: 6, width: `${Math.round((d.passed / d.total) * 100)}%`, backgroundColor: t.primary }} />
            </View>
            {missing.slice(0, 3).map((c) => (
                <Pressable key={c.key} onPress={() => fix(c)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, opacity: pressed ? 0.7 : 1 })}>
                    <Icon name={c.optional ? 'info' : 'warning'} size={18} color={c.optional ? t.muted : t.danger} />
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                        <Text style={{ color: t.text, fontWeight: '700' }}>{c.label}{c.optional ? ' (optional)' : ''}</Text>
                        <Text style={{ color: t.muted, fontSize: font.xs }}>{c.fix}</Text>
                    </View>
                    <Icon name="next" size={16} color={t.muted} />
                </Pressable>
            ))}
            <Button small kind="soft" icon="tune" title="Guided setup: every setting, step by step" onPress={() => nav.navigate('ShopSetup', { shopId, name })} style={{ marginTop: spacing.sm }} />
        </Card>
    );
}
