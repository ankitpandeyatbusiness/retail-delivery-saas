import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, radius, font } from '../theme';
import { Button } from './ui';
import { TextField, NumberField } from './settingsForm';
import { ToggleRow } from './inputs';
import Icon from './Icon';

export const MAX_GROUPS = 8;
export const MAX_OPTIONS = 30;

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

// Server ids are short and stable ("large", "oat-milk"). Keep the ones that exist, make new ones from the name.
export function withIds(groups) {
    const usedG = new Set();
    return groups.map((g, gi) => {
        let gid = g.id || slug(g.name) || `group-${gi + 1}`;
        while (usedG.has(gid)) gid = `${gid}-${gi + 1}`.slice(0, 30);
        usedG.add(gid);
        const usedO = new Set();
        const options = (g.options || []).map((o, oi) => {
            let id = o.id || slug(o.name) || `option-${oi + 1}`;
            while (usedO.has(id)) id = `${id}-${oi + 1}`.slice(0, 30);
            usedO.add(id);
            return { id, name: o.name.trim(), price: Number(o.price) || 0, isDefault: !!o.isDefault, isAvailable: o.isAvailable !== false };
        });
        const max = Math.min(Math.max(Number(g.max) || 1, 1), Math.max(options.length, 1));
        const min = Math.min(Math.max(Number(g.min) || 0, 0), max);
        return { id: gid, name: g.name.trim(), min, max, options };
    });
}

// what the customer can choose on a dish: "Choose size", "Add extras", "Milk type"...
export default function OptionGroupsEditor({ value = [], onChange }) {
    const t = useTheme();
    const setGroup = (gi, patch) => onChange(value.map((g, i) => (i === gi ? { ...g, ...patch } : g)));
    const setOption = (gi, oi, patch) => setGroup(gi, { options: value[gi].options.map((o, i) => (i === oi ? { ...o, ...patch } : o)) });

    return (
        <View>
            {value.map((g, gi) => (
                <View key={gi} style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.lg, padding: spacing.md, marginBottom: spacing.md, backgroundColor: t.surfaceAlt }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm }}>
                        <Text style={{ color: t.text, fontWeight: '800' }}>Group {gi + 1}</Text>
                        <Pressable onPress={() => onChange(value.filter((_, i) => i !== gi))} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Icon name="trash" size={18} color={t.danger} />
                            <Text style={{ color: t.danger, fontWeight: '700', marginLeft: 4 }}>Remove</Text>
                        </Pressable>
                    </View>
                    <TextField label="Question shown to the customer" value={g.name} maxLength={40} placeholder="e.g. Choose size" onChange={(x) => setGroup(gi, { name: x })} />
                    <View style={{ flexDirection: 'row', gap: spacing.md }}>
                        <NumberField style={{ flex: 1 }} label="Must pick at least" integer value={g.min} onChange={(x) => setGroup(gi, { min: x ?? 0 })} hint="0 = optional" />
                        <NumberField style={{ flex: 1 }} label="Can pick up to" integer value={g.max} onChange={(x) => setGroup(gi, { max: x ?? 1 })} hint="1 = pick one" />
                    </View>

                    {g.options.map((o, oi) => (
                        <View key={oi} style={{ backgroundColor: t.surface, borderRadius: radius.md, padding: spacing.md, marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
                                <View style={{ flex: 1.6 }}>
                                    <TextField label={oi === 0 ? 'Option' : undefined} value={o.name} maxLength={40} placeholder="e.g. Large" last onChange={(x) => setOption(gi, oi, { name: x })} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <NumberField label={oi === 0 ? 'Extra ₹' : undefined} value={o.price} last onChange={(x) => setOption(gi, oi, { price: x ?? 0 })} />
                                </View>
                                <Pressable onPress={() => setGroup(gi, { options: g.options.filter((_, i) => i !== oi) })} hitSlop={8} style={{ height: 48, justifyContent: 'center' }}>
                                    <Icon name="clear" size={22} color={t.muted} />
                                </Pressable>
                            </View>
                            <View style={{ flexDirection: 'row' }}>
                                <View style={{ flex: 1 }}>
                                    <ToggleRow title="Selected by default" value={!!o.isDefault} onValueChange={(x) => setOption(gi, oi, { isDefault: x })} last />
                                </View>
                            </View>
                            <ToggleRow title="Available" value={o.isAvailable !== false} onValueChange={(x) => setOption(gi, oi, { isAvailable: x })} last />
                        </View>
                    ))}
                    {g.options.length < MAX_OPTIONS ? (
                        <Button title="Add an option" kind="soft" small icon="add" onPress={() => setGroup(gi, { options: [...g.options, { name: '', price: 0, isDefault: false, isAvailable: true }] })} />
                    ) : null}
                </View>
            ))}
            {value.length < MAX_GROUPS ? (
                <Button title="Add a choice group" kind="outline" icon="addCircle" onPress={() => onChange([...value, { name: '', min: 0, max: 1, options: [{ name: '', price: 0, isDefault: false, isAvailable: true }] }])} />
            ) : null}
        </View>
    );
}
