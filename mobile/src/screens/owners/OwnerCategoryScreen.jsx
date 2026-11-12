// One category: name, picture, hours (breakfast only 07:00-11:00...) and whether customers see it.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ToggleRow, ChoiceBox, Hint, Label, ImageField, TimingEditor } from '../../components/owners/menuBits';
import { categories as categoriesApi, apiError } from '../../api/owners/shopApi';
import { useMenuStore } from '../../store/owners/useMenuStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { TIME_RE } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const BLANK = { name: '', image: '', imageSource: 'auto', isActive: true, timings: [] };
const fromRecord = (r) => ({ name: r.name || '', image: r.image || '', imageSource: r.imageSource || 'auto', isActive: r.isActive !== false, timings: (r.timings || []).map((s) => ({ days: s.days || [], open: s.open, close: s.close })) });

// "Or pick a picture from this category's dishes"
function DishPictures({ pics, value, onPick }) {
    const { primary, border } = useBrand();
    if (!pics.length) return <Hint>{tr('Add items with pictures to this category and you can pick one of them here.')}</Hint>;
    return (
        <View style={{ marginTop: 14 }}>
            <Label>{tr('Or pick a picture from this category\'s items')}</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {pics.map((p) => {
                    const on = p.url === value;
                    return (
                        <Pressable key={p.url} onPress={() => onPick(on ? '' : p.url)} style={{ marginRight: 8 }}>
                            <Image source={{ uri: p.url }} style={{ width: 70, height: 70, borderRadius: 12, borderWidth: 3, borderColor: on ? primary : 'transparent' }} contentFit="cover" />
                            {on ? <View style={{ position: 'absolute', right: 4, top: 4, width: 20, height: 20, borderRadius: 10, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="checkmark" size={13} color="#FFFFFF" /></View> : null}
                        </Pressable>
                    );
                })}
            </ScrollView>
        </View>
    );
}

export default function OwnerCategoryScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const products = useMenuStore((s) => s.products);
    const [form, setForm] = useState(id ? null : BLANK);
    const [loadError, setLoadError] = useState('');
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!id) return;
        let alive = true;
        categoriesApi.get(id).then((r) => alive && setForm(fromRecord(r)))
            .catch((e) => { useOwnerStore.getState().noteError(e); if (alive) setLoadError(apiError(e, 'Could not open this category.')); });
        return () => { alive = false; };
    }, [id]);

    const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };

    if (!form) {
        return <FormPage title={tr('Category')}>{loadError ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={loadError} /> : <FormShimmer />}</FormPage>;
    }
    const v = form;
    const seen = new Set();
    const pics = id ? products.filter((p) => String(p.categoryId) === id && p.image && !seen.has(p.image) && seen.add(p.image)).map((p) => ({ url: p.image })) : [];

    const save = async () => {
        const e = {};
        if (!v.name.trim()) e.name = 'Enter a category name';
        v.timings.forEach((s, i) => { if (!TIME_RE.test(s.open) || !TIME_RE.test(s.close)) e.timings = `Time slot ${i + 1}: use 24-hour time like 07:30`; });
        if (Object.keys(e).length) { setErrors(e); showToast(Object.values(e)[0]); return; }
        setSaving(true);
        const body = {
            name: v.name.trim(), image: v.image || '', imageSource: v.imageSource || 'auto', isActive: v.isActive,
            timings: v.timings.map((s) => ({ open: s.open, close: s.close, ...(s.days?.length ? { days: s.days } : {}) })),
        };
        try {
            if (id) await categoriesApi.update(id, body); else await categoriesApi.create(body);
            showToast(id ? tr('Category saved') : tr('Category added'));
            useMenuStore.getState().load({ quiet: true });
            nav.goBack();
        } catch (err) { useOwnerStore.getState().noteError(err); showToast(apiError(err)); } finally { setSaving(false); }
    };

    return (
        <FormPage title={id ? tr('Edit category') : tr('New category')} hero={{ icon: 'albums', subtitle: tr('A group of dishes on your menu') }} footer={<Button label={id ? tr('Save changes') : tr('Add category')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('Category')}>
                <TextBox label={tr('Name')} value={v.name} onChangeText={(x) => set('name', x)} error={errors.name} placeholder={tr('e.g. Starters')} maxLength={60} />
                <ImageField label={tr('Picture (optional)')} value={v.image} onChange={(x) => set('image', x)} kind="category" last />
                {id ? <DishPictures pics={pics} value={v.image} onPick={(x) => set('image', x)} /> : null}
                <ChoiceBox label={tr('Picture customers see')} options={[['auto', tr('Automatic')], ['own', tr('My own picture')], ['dish', tr('A dish picture')]]} value={v.imageSource || 'auto'} onChange={(x) => set('imageSource', x)} last />
                <Hint>{v.imageSource === 'own' ? tr('Only your own picture. With none, customers see the big first letter of the name.') : v.imageSource === 'dish' ? tr('A picture of one of the items: the first item with a picture, and the next one if that item has none. With none at all, the big first letter.') : tr('Your own picture; with none, a picture of one of the items, and with none at all, the big first letter.')}</Hint>
            </Group>
            <Group title={tr('Show it')}>
                <ToggleRow title={tr('Visible to customers')} subtitle={tr('Switch off to hide the whole category')} value={v.isActive} onValueChange={(x) => set('isActive', x)} last />
            </Group>
            <Group title={tr('Only at some hours')} hint={tr('Empty = shown all day. For example Breakfast 07:00 to 11:00. A time past midnight, like 18:00 to 02:00, works too.')}>
                <TimingEditor value={v.timings} onChange={(x) => set('timings', x)} />
                {errors.timings ? <Hint tone="warn">{errors.timings}</Hint> : null}
            </Group>
        </FormPage>
    );
}
