import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Chip } from './ui';
import { toast } from './feedback';
import { errMsg } from '../api/adminClient';
import { setShopBroughtBy } from '../api/moneyRecordApi';
import { useSupreme } from '../hooks/useSupreme';

export const rs = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const dayOf = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');

// "Who brought this shop": decides if the developer's part of what it pays is 50% (Vivyaan brought it) or 70% (the developer did).
// Everybody sees it; only the supreme admin sets it. A shop nobody marked counts as Vivyaan's.
export function BroughtByCard({ shopId, current, onChanged }) {
    const t = useTheme();
    const supreme = useSupreme();
    const [busy, setBusy] = useState(false);
    const set = async (side) => {
        if (side === current || busy) return;
        setBusy(true);
        try { await setShopBroughtBy(shopId, side); toast('Saved'); onChanged?.(); }
        catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <View style={{ marginBottom: spacing.md, padding: spacing.lg, borderRadius: 16, backgroundColor: t.surface }}>
            <Text style={{ color: t.text, fontWeight: '800' }}>Who brought this shop</Text>
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                {current === 'owner' ? 'The developer brought it: the developer\'s part of what it pays (before GST) is 70%.'
                    : current === 'partner' ? 'Vivyaan brought it: the developer\'s part of what it pays (before GST) is 50%.'
                        : 'Not marked yet, so it counts as Vivyaan\'s: the developer\'s part is 50%.'}
            </Text>
            {supreme ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    <Chip label="Developer brought it" active={current === 'owner'} onPress={() => set('owner')} />
                    <Chip label="Vivyaan brought it" active={current === 'partner'} onPress={() => set('partner')} />
                </View>
            ) : null}
        </View>
    );
}

// while creating a shop: who brought it (only the supreme admin sees this)
export function BroughtByPicker({ value, onChange }) {
    const t = useTheme();
    const supreme = useSupreme();
    if (!supreme) return null;
    return (
        <View style={{ marginBottom: spacing.lg }}>
            <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '600', marginBottom: 6 }}>Who brought this shop</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Chip label="Developer brought it" active={value === 'owner'} onPress={() => onChange('owner')} />
                <Chip label="Vivyaan brought it" active={value === 'partner'} onPress={() => onChange('partner')} />
            </View>
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 4 }}>Decides the developer's part of its payments: 70% if the developer brought it, 50% if Vivyaan did. You can change it later.</Text>
        </View>
    );
}
