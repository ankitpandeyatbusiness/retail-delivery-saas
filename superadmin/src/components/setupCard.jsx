import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../theme';
import { Card, Button } from './ui';
import Icon from './Icon';
import { fetchReadiness } from '../api/insightsApi';
import { FIX_SCREEN } from '../utils/setupFlow';

// "Set-up 8 of 12": what is still missing on this shop, each line opens where it is fixed. Hidden when everything is done.
export default function SetupCard({ shopId, name }) {
    const t = useTheme();
    const nav = useNavigation();
    const [d, setD] = useState(null);
    useFocusEffect(useCallback(() => { fetchReadiness(shopId).then(setD).catch(() => { }); }, [shopId]));
    if (!d || d.passed >= d.total) return null;
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
