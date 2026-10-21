import React, { useEffect, useRef, useState } from 'react';
import { View, Text, Image, Pressable, TextInput, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, radius, font, TAP } from '../theme';
import { Button } from './ui';
import { Label } from './settingsForm';
import { toast } from './feedback';
import Icon from './Icon';
import { pickImage, uploadImage } from '../utils/upload';
import { errMsg } from '../api/adminClient';
import { ActivityIndicator } from './Loading';
import { useSlideTick, seedOf } from '../hooks/useSlideTick';

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

/*
 * Up to 4 more pictures of a dish (the same as "More pictures" in the shop owner's menu). The customer app slides through the main
 * picture and these by itself. Each can be moved left or right, or made the main picture (the star); onMain(url) swaps it with the main one.
 */
export function MorePictures({ value = [], onChange, onMain, shopId, refId, disabled }) {
    const t = useTheme();
    const [busy, setBusy] = useState(false);
    const add = async () => {
        if (busy || value.length >= 4) return;
        setBusy(true);
        try {
            const img = await pickImage({});
            if (!img) return;
            const m = await uploadImage(shopId, { kind: 'product', refId, ...img });
            onChange([...value, m.url]);
        } catch (e) { toast(e.safe ? e.message : errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= value.length) return;
        const next = [...value];
        [next[i], next[j]] = [next[j], next[i]];
        onChange(next);
    };
    const chip = (name, onPress, off, key) => (
        <Pressable key={key} onPress={onPress} disabled={off} hitSlop={4} style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.6)', opacity: off ? 0.3 : 1 }}>
            <Ionicons name={name} size={13} color="#FFFFFF" />
        </Pressable>
    );
    return (
        <View style={{ marginTop: spacing.lg }}>
            <Label>More pictures (optional)</Label>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {value.map((u, i) => (
                    <View key={u} style={{ marginRight: spacing.md, marginBottom: spacing.md }}>
                        <Image source={{ uri: u }} style={{ width: 84, height: 84, borderRadius: radius.md, backgroundColor: t.surfaceAlt }} />
                        <Pressable onPress={() => onChange(value.filter((x) => x !== u))} hitSlop={8} style={{ position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: t.danger, alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="close" size={14} color="#FFFFFF" />
                        </Pressable>
                        {onMain ? <View style={{ position: 'absolute', top: 4, left: 4 }}>{chip('star', () => onMain(u), false, 's')}</View> : null}
                        <View style={{ position: 'absolute', bottom: 4, left: 4, right: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                            {chip('chevron-back', () => move(i, -1), i === 0, 'l')}
                            {chip('chevron-forward', () => move(i, 1), i === value.length - 1, 'r')}
                        </View>
                    </View>
                ))}
                {value.length < 4 ? (
                    <Pressable onPress={add} disabled={disabled || busy} style={{ width: 84, height: 84, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: t.border, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.5 : 1 }}>
                        {busy ? <ActivityIndicator color={t.primary} /> : <Ionicons name="add" size={26} color={t.primary} />}
                    </Pressable>
                ) : null}
            </View>
            <Text style={{ color: t.muted, fontSize: font.sm }}>{disabled ? 'Add the main picture first.' : 'They slide in this order. Use the arrows to move one, the star to make it the main picture.'}</Text>
        </View>
    );
}

/*
 * A dish's thumbnail in a list. A dish with more pictures slides through them by itself (all dishes on one clock, each starting at its own
 * place), with a soft fade, like the menu in the shop owner's app.
 */
export function DishPic({ item, size = 56, fallback }) {
    const t = useTheme();
    const pics = [item?.image, ...(Array.isArray(item?.images) ? item.images : [])].filter(Boolean);
    const slides = pics.length > 1;
    const tick = useSlideTick(slides);
    const uri = slides ? pics[(tick + seedOf(item)) % pics.length] : pics[0];
    const fade = useRef(new Animated.Value(1)).current;
    useEffect(() => {
        if (!slides) return;
        fade.setValue(0.25);
        Animated.timing(fade, { toValue: 1, duration: 450, useNativeDriver: true }).start();
    }, [uri]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (!uri) return fallback || null;
    return <Animated.Image source={{ uri }} style={{ width: size, height: size, borderRadius: radius.md, backgroundColor: t.surfaceAlt, opacity: fade }} />;
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
