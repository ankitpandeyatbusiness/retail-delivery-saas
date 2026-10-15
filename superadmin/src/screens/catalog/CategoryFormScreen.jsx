import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, ScrollView, Image } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { listRecords } from '../../api/catalogApi';
import { Screen } from '../../components/layout';
import { Button, Chip, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, NumberField, Switch, Hint, Label, TextField } from '../../components/settingsForm';
import { ImageField } from '../../components/catalogBits';
import { Loading, ErrorBox, ConfirmSheet } from '../../components/feedback';
import useRecordForm from '../../hooks/useRecordForm';
import Icon from '../../components/Icon';

const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']];
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const maskTime = (v) => {
    const d = v.replace(/[^\d]/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};

const BLANK = { name: '', image: '', sortOrder: 0, isActive: true, timings: [] };

// "Or pick one of this category's dishes": a row of the dishes' pictures, the chosen one is outlined
function DishPictures({ pics, value, onPick }) {
    const t = useTheme();
    if (!pics.length) return <Hint>Add dishes with pictures to this category and you can pick one of them here.</Hint>;
    return (
        <View style={{ marginTop: spacing.lg, marginBottom: spacing.sm }}>
            <Label>Or pick a picture from this category's dishes</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: spacing.sm }}>
                {pics.map((p) => {
                    const on = p.url === value;
                    return (
                        <Pressable key={p.url} onPress={() => onPick(on ? '' : p.url)} accessibilityLabel={p.name} style={{ marginRight: spacing.sm }}>
                            <Image
                                source={{ uri: p.url }}
                                style={{ width: 72, height: 72, borderRadius: radius.md, backgroundColor: t.surfaceAlt, borderWidth: 3, borderColor: on ? t.primary : 'transparent' }}
                            />
                            {on ? (
                                <View style={{ position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: t.primary, alignItems: 'center', justifyContent: 'center' }}>
                                    <Icon name="check" size={13} color="#FFFFFF" />
                                </View>
                            ) : null}
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

// A category of the menu. Timings make it appear only at some hours (breakfast, lunch...).
export default function CategoryFormScreen() {
    const t = useTheme();
    const { shopId, name: shopName, id } = useRoute().params;
    const [confirmOff, setConfirmOff] = useState(false);
    const [dishPics, setDishPics] = useState([]);   // pictures of the dishes that are in this category

    // the pictures of this category's dishes, so one can be picked as the category picture
    useEffect(() => {
        if (!id) return;
        listRecords(shopId, 'products', { categoryId: id, limit: 100 })
            .then((r) => {
                const seen = new Set();
                setDishPics((r.items || []).filter((p) => p.image && !seen.has(p.image) && seen.add(p.image)).map((p) => ({ url: p.image, name: p.name })));
            })
            .catch(() => setDishPics([]));
    }, [shopId, id]);

    const f = useRecordForm({
        shopId, resource: 'categories', id, blank: BLANK,
        fromRecord: (r) => ({ name: r.name || '', image: r.image || '', sortOrder: r.sortOrder || 0, isActive: r.isActive !== false, timings: (r.timings || []).map((s) => ({ days: s.days || [], open: s.open, close: s.close })) }),
        validate: (v) => {
            const e = {};
            if (!v.name.trim()) e.name = 'Enter a category name';
            v.timings.forEach((s, i) => { if (!TIME.test(s.open) || !TIME.test(s.close)) e[`timings`] = `Time slot ${i + 1}: use 24-hour time like 07:30`; });
            return e;
        },
        toBody: useMemo(() => (v) => ({
            name: v.name.trim(),
            image: v.image || '',
            sortOrder: v.sortOrder || 0,
            isActive: v.isActive,
            timings: v.timings.map((s) => ({ open: s.open, close: s.close, ...(s.days?.length ? { days: s.days } : {}) })),
        }), []),
        label: id ? 'Category saved' : 'Category added',
    });

    if (!f.form) return <Screen title="Category" subtitle={shopName}>{f.error ? <ErrorBox message={f.error} onRetry={f.reload} /> : <Loading />}</Screen>;
    const v = f.form;
    const setTiming = (i, patch) => f.set('timings', v.timings.map((s, n) => (n === i ? { ...s, ...patch } : s)));

    return (
        <Screen
            title={f.isNew ? 'New category' : 'Edit category'}
            subtitle={shopName}
            footer={<Button title={f.isNew ? 'Add category' : 'Save changes'} icon="check" onPress={f.save} loading={f.saving} />}
        >
            <Card>
                <Field label="Name" value={v.name} onChangeText={(x) => f.set('name', x)} error={f.errors.name} placeholder="e.g. Starters" maxLength={60} />
                <ImageField label="Picture (optional)" value={v.image} onChange={(x) => f.set('image', x)} shopId={shopId} kind="category" />
                {id ? (
                    <DishPictures
                        pics={dishPics}
                        value={v.image}
                        onPick={(x) => f.set('image', x)}
                    />
                ) : null}
                <Hint>No picture chosen: customers see the picture of the first dish added to this category.</Hint>
            </Card>

            <Group title="Show it" section="catalog" flush>
                <Switch title="Visible to customers" subtitle="Switch off to hide the whole category" value={v.isActive} onValueChange={(x) => f.set('isActive', x)} last />
            </Group>

            <Group title="Order" section="catalog">
                <NumberField label="Position" integer hint="Smaller numbers come first" value={v.sortOrder} onChange={(x) => f.set('sortOrder', x ?? 0)} last />
            </Group>

            <Group title="Only at some hours" section="orders" hint="Empty = shown all day. For example Breakfast 07:00 to 11:00.">
                {v.timings.map((s, i) => (
                    <View key={i} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border, paddingTop: i ? spacing.md : 0, marginBottom: spacing.md }}>
                        <View style={{ flexDirection: 'row', gap: spacing.md }}>
                            <View style={{ flex: 1 }}>
                                <TextField label="From" value={s.open} placeholder="HH:MM" keyboardType="number-pad" maxLength={5} last onChange={(x) => setTiming(i, { open: maskTime(x) })} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <TextField label="To" value={s.close} placeholder="HH:MM" keyboardType="number-pad" maxLength={5} last onChange={(x) => setTiming(i, { close: maskTime(x) })} />
                            </View>
                        </View>
                        <Label hint="Leave all unselected for every day">Days</Label>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                            {DAYS.map(([d, l]) => (
                                <Chip key={d} label={l} active={(s.days || []).includes(d)} onPress={() => setTiming(i, { days: (s.days || []).includes(d) ? s.days.filter((x) => x !== d) : [...(s.days || []), d] })} />
                            ))}
                        </View>
                        <Pressable onPress={() => f.set('timings', v.timings.filter((_, n) => n !== i))} style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm }}>
                            <Icon name="trash" size={18} color={t.danger} />
                            <Text style={{ color: t.danger, fontWeight: '700', marginLeft: 6 }}>Remove this time slot</Text>
                        </Pressable>
                    </View>
                ))}
                {v.timings.length < 6 ? (
                    <Button title="Add a time slot" kind="soft" small icon="clock" onPress={() => f.set('timings', [...v.timings, { days: [], open: '07:00', close: '11:00' }])} />
                ) : <Hint>Up to 6 time slots.</Hint>}
                {f.errors.timings ? <Hint tone="warn">{f.errors.timings}</Hint> : null}
            </Group>

            {!f.isNew ? (
                <Button title="Switch this category off" kind="dangerSoft" icon="block" style={{ marginTop: spacing.xl }} onPress={() => setConfirmOff(true)} />
            ) : null}

            <ConfirmSheet
                visible={confirmOff}
                onClose={() => setConfirmOff(false)}
                title="Switch this category off?"
                message="It disappears from the customer app. Its items stay in the shop and come back when you switch it on again."
                confirmLabel="Switch off"
                danger
                onConfirm={f.remove}
            />
        </Screen>
    );
}
