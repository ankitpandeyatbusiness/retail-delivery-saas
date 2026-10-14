import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, radius } from '../theme';
import { Button } from './ui';
import { NumberField } from './settingsForm';
import Icon from './Icon';

// Price tiers: "up to N orders -> fee". The last tier has no limit (upTo = null).
//   value: [{ upTo: 305, fee: 3000 }, { upTo: 1005, fee: 6000 }, { upTo: null, fee: 10000 }]
export function tiersProblem(tiers) {
    if (!tiers?.length) return 'Add at least one tier';
    let prev = 0;
    for (let i = 0; i < tiers.length; i += 1) {
        const x = tiers[i];
        const last = i === tiers.length - 1;
        if (x.fee === undefined || x.fee === null || x.fee < 0) return `Tier ${i + 1}: enter the fee`;
        if (last) { if (x.upTo !== null) return 'The last tier must have no limit'; } else {
            if (!Number.isInteger(x.upTo) || x.upTo <= prev) return `Tier ${i + 1}: orders must be more than ${prev}`;
            prev = x.upTo;
        }
    }
    return null;
}

export default function TiersEditor({ value, onChange }) {
    const t = useTheme();
    const set = (i, patch) => onChange(value.map((x, n) => (n === i ? { ...x, ...patch } : x)));
    const add = () => {
        // a new tier goes before the open-ended last one
        const last = value[value.length - 1];
        const prev = value.length > 1 ? value[value.length - 2].upTo || 0 : 0;
        onChange([...value.slice(0, -1), { upTo: prev + 100, fee: last?.fee || 0 }, last]);
    };
    return (
        <View>
            {value.map((x, i) => {
                const last = i === value.length - 1;
                const from = i === 0 ? 0 : (value[i - 1].upTo || 0) + 1;
                return (
                    <View key={i} style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm, backgroundColor: t.surfaceAlt }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                            <Text style={{ color: t.text, fontWeight: '800' }}>{last ? `${from} orders and more` : `${from} to ${x.upTo ?? '…'} orders`}</Text>
                            {!last && value.length > 2 ? (
                                <Pressable onPress={() => onChange(value.filter((_, n) => n !== i))} hitSlop={8}><Icon name="trash" size={18} color={t.danger} /></Pressable>
                            ) : null}
                        </View>
                        <View style={{ flexDirection: 'row', gap: spacing.md }}>
                            {!last ? <NumberField style={{ flex: 1 }} label="Up to (orders)" integer value={x.upTo} onChange={(v) => set(i, { upTo: v })} last /> : null}
                            <NumberField style={{ flex: 1 }} label="Monthly fee" prefix="₹" value={x.fee} onChange={(v) => set(i, { fee: v })} last />
                        </View>
                    </View>
                );
            })}
            {value.length < 8 ? <Button title="Add a tier" kind="soft" small icon="add" onPress={add} /> : null}
        </View>
    );
}
