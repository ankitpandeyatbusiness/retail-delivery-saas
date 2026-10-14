import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Chip, Button } from './ui';
import { Label, NumberField, Switch, Hint } from './settingsForm';
import Icon from './Icon';

// 250 -> "250 g", 1500 -> "1.5 kg" (ml / L for volume)
export function amountLabel(sellBy, qty) {
    const [small, big] = sellBy === 'volume' ? ['ml', 'L'] : ['g', 'kg'];
    return qty >= 1000 ? `${Math.round(qty) / 1000} ${big}` : `${qty} ${small}`;
}

/*
 * The amounts a customer can pick for an item sold by weight or volume.
 *   value: { options: [grams|ml], min, allowManual }
 * Quick sizes are chips; any other amount can be added in g/kg (ml/L); the customer may also type their own.
 */
export function MeasureEditor({ sellBy, value, presets, onChange, error }) {
    const t = useTheme();
    const [small, big] = sellBy === 'volume' ? ['ml', 'L'] : ['g', 'kg'];
    const [typed, setTyped] = useState(undefined);
    const [unit, setUnit] = useState(small);

    // a new item starts with the platform's quick sizes already chosen
    useEffect(() => {
        if (!value.options.length) onChange({ ...value, options: presets.filter((p) => p <= 1000).slice(0, 3) });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sellBy]);
    useEffect(() => { setUnit(small); }, [small]);

    const options = [...new Set([...presets, ...value.options])].sort((a, b) => a - b);
    const has = (q) => value.options.includes(q);
    const toggle = (q) => onChange({ ...value, options: has(q) ? value.options.filter((x) => x !== q) : [...value.options, q].sort((a, b) => a - b) });

    const addTyped = () => {
        const q = Math.round((unit === big ? 1000 : 1) * Number(typed));
        if (!(q >= 10 && q <= 50000)) return;
        if (!has(q)) onChange({ ...value, options: [...value.options, q].sort((a, b) => a - b) });
        setTyped(undefined);
    };

    return (
        <View>
            <Label hint="Tap to switch a size on or off">Quick sizes</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {options.map((q) => (
                    <View key={q} style={{ marginBottom: spacing.sm }}>
                        <Chip label={amountLabel(sellBy, q)} active={has(q)} onPress={() => toggle(q)} />
                    </View>
                ))}
            </View>

            <Label>Another size</Label>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm }}>
                <NumberField style={{ flex: 1 }} label="" value={typed} onChange={setTyped} placeholder="e.g. 750" last />
                <Pressable onPress={() => setUnit(unit === small ? big : small)} style={{ height: 52, minWidth: 56, borderRadius: 14, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', paddingHorizontal: 10 }}>
                    <Text style={{ color: t.primary, fontWeight: '800' }}>{unit}</Text>
                    <Icon name="next" size={14} color={t.primary} style={{ marginLeft: 4 }} />
                </Pressable>
                <Button title="Add" small kind="soft" onPress={addTyped} style={{ height: 52 }} />
            </View>

            <View style={{ height: spacing.lg }} />
            <Switch title="Customer can type their own amount" subtitle="For example 650 g or 1.25 kg" value={value.allowManual} onValueChange={(x) => onChange({ ...value, allowManual: x })} />
            <NumberField label={`Smallest amount the customer can order (${small})`} integer value={value.min} onChange={(x) => onChange({ ...value, min: x })} placeholder="50" hint={error} last />
            <Hint>The customer sees the price worked out from the price per {sellBy === 'volume' ? 'litre' : 'kg'}.</Hint>
        </View>
    );
}
