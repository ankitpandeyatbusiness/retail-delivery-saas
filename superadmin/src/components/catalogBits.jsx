import React, { useState } from 'react';
import { View, Text, Image, Pressable, TextInput } from 'react-native';
import { useTheme, spacing, radius, font, TAP } from '../theme';
import { Button } from './ui';
import { Label } from './settingsForm';
import { toast } from './feedback';
import Icon from './Icon';
import { pickImage, uploadImage } from '../utils/upload';
import { errMsg } from '../api/adminClient';

/*
 * A picture for a record. Shows the current one, uploads a new one right away, and gives back its url.
 *   kind: product | category | banner | collection | logo ...   refId: needed for 'product' (the product id)
 */
export function ImageField({ label = 'Picture', value, onChange, shopId, kind, refId, square, last }) {
    const t = useTheme();
    const [busy, setBusy] = useState(false);

    const pick = async () => {
        setBusy(true);
        try {
            const img = await pickImage({ square });
            if (!img) return;
            const m = await uploadImage(shopId, { kind, refId, ...img });
            onChange(m.url);
        } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            <Label>{label}</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                {value ? (
                    <Image source={{ uri: value }} style={{ width: 84, height: 84, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
                ) : (
                    <View style={{ width: 84, height: 84, borderRadius: radius.md, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center' }}>
                        <Icon name="banner" size={30} color={t.muted} />
                    </View>
                )}
                <View style={{ flex: 1, marginLeft: spacing.lg }}>
                    <Button title={value ? 'Change picture' : 'Add picture'} icon="banner" kind="soft" small loading={busy} onPress={pick} />
                    {value ? (
                        <Pressable onPress={() => onChange('')} style={{ marginTop: spacing.sm }} hitSlop={8}>
                            <Text style={{ color: t.danger, fontWeight: '700', fontSize: font.sm }}>Remove picture</Text>
                        </Pressable>
                    ) : null}
                </View>
            </View>
        </View>
    );
}

// "20261101" -> "2026-11-01" while typing
const maskDate = (v) => {
    const d = v.replace(/[^\d]/g, '').slice(0, 8);
    if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return d;
};

/* a day typed as digits, shown as YYYY-MM-DD. Empty = no date. */
export function DateField({ label, hint, value, onChange, last }) {
    const t = useTheme();
    const bad = value && !/^\d{4}-\d{2}-\d{2}$/.test(value);
    return (
        <View style={{ marginBottom: last ? 0 : spacing.lg }}>
            {label ? <Label hint={hint}>{label}</Label> : null}
            <TextInput
                value={value || ''}
                onChangeText={(v) => onChange(maskDate(v))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={t.muted}
                keyboardType="number-pad"
                maxLength={10}
                style={{
                    height: TAP, borderRadius: radius.md, borderWidth: 1, borderColor: bad ? t.danger : t.border, backgroundColor: t.surface,
                    color: t.text, paddingHorizontal: spacing.md, fontSize: font.md, fontWeight: '600',
                }}
            />
            {bad ? <Text style={{ color: t.danger, fontSize: font.xs, marginTop: 4 }}>Type the date as 2026-11-01</Text> : null}
        </View>
    );
}

/* the small coloured square for veg / non-veg, as on food apps */
export function VegMark({ isVeg, size = 14 }) {
    const c = isVeg ? '#16A34A' : '#DC2626';
    return (
        <View style={{ width: size, height: size, borderWidth: 1.5, borderColor: c, borderRadius: 3, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: size * 0.5, height: size * 0.5, borderRadius: size, backgroundColor: c }} />
        </View>
    );
}
