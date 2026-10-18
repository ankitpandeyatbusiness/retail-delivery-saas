// One collection: kind, title, picture, the items in it (picked from the menu), optional dates.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty, Sheet, Field, money } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ChoiceBox, ToggleRow, Hint, ImageField, DateBox, VegMark } from '../../components/owners/menuBits';
import { collections as collectionsApi, apiError } from '../../api/owners/shopApi';
import { useMenuStore } from '../../store/owners/useMenuStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ymdOf, isoOfYmd } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const MAX_ITEMS = 30;
const BLANK = { kind: 'festival', title: '', subtitle: '', image: '', productIds: [], startsAt: '', endsAt: '', isActive: true };

// choose items from the menu
function ItemPicker({ visible, onClose, selected, onDone }) {
    const { text, muted, border, primary } = useBrand();
    const products = useMenuStore((s) => s.products);
    const [picked, setPicked] = useState(selected);
    const [q, setQ] = useState('');
    useEffect(() => { if (visible) { setPicked(selected); setQ(''); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const list = products.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 150);
    const toggle = (id) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : x.length >= MAX_ITEMS ? (showToast(tr('Up to {MAX_ITEMS} items', { MAX_ITEMS: MAX_ITEMS })), x) : [...x, id]));
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Choose items ({length}/{MAX_ITEMS})', { length: picked.length, MAX_ITEMS: MAX_ITEMS })}>
            <Field value={q} onChangeText={setQ} placeholder={tr('Find an item')} maxLength={40} style={{ marginBottom: 8 }} />
            {list.map((p) => {
                const on = picked.includes(String(p._id));
                return (
                    <Pressable key={p._id} onPress={() => toggle(String(p._id))} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 11, borderBottomWidth: 0.5, borderBottomColor: border }}>
                        <Ionicons name={on ? 'checkbox' : 'square-outline'} size={24} color={on ? primary : muted} />
                        <View style={{ marginLeft: 12 }}><VegMark isVeg={p.isVeg} size={12} /></View>
                        <Text style={{ flex: 1, color: text, fontWeight: '700', marginLeft: 8 }} numberOfLines={1}>{p.name}</Text>
                        <Text style={{ color: muted }}>{money(p.price)}</Text>
                    </Pressable>
                );
            })}
            {!list.length ? <Text style={{ color: muted, padding: 20, textAlign: 'center' }}>{tr('No item found')}</Text> : null}
            <View style={{ height: 10 }} />
            <Button label={tr('Done')} icon="checkmark" onPress={() => { onDone(picked); onClose(); }} />
        </Sheet>
    );
}

export default function OwnerCollectionScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const { text, muted, border } = useBrand();
    const products = useMenuStore((s) => s.products);
    const [form, setForm] = useState(id ? null : BLANK);
    const [loadError, setLoadError] = useState('');
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [picker, setPicker] = useState(false);

    useEffect(() => { const st = useMenuStore.getState(); if (!st.loadedAt) st.load({ quiet: true }); }, []);
    useEffect(() => {
        if (!id) return;
        let alive = true;
        collectionsApi.get(id).then((r) => alive && setForm({
            kind: r.kind || 'festival', title: r.title || '', subtitle: r.subtitle || '', image: r.image || '',
            productIds: (r.productIds || []).map(String), startsAt: ymdOf(r.startsAt), endsAt: ymdOf(r.endsAt), isActive: r.isActive !== false,
        })).catch((e) => { useOwnerStore.getState().noteError(e); if (alive) setLoadError(apiError(e, 'Could not open this collection.')); });
        return () => { alive = false; };
    }, [id]);

    const byId = useMemo(() => new Map(products.map((p) => [String(p._id), p])), [products]);
    const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };

    if (!form) {
        return <FormPage title={tr('Collection')}>{loadError ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={loadError} /> : <FormShimmer />}</FormPage>;
    }
    const v = form;

    const save = async () => {
        const e = {};
        if (!v.title.trim()) e.title = 'Enter a title';
        if (v.startsAt && !/^\d{4}-\d{2}-\d{2}$/.test(v.startsAt)) e.startsAt = 'Type the date as 2026-11-01';
        if (v.endsAt && !/^\d{4}-\d{2}-\d{2}$/.test(v.endsAt)) e.endsAt = 'Type the date as 2026-11-01';
        if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) e.endsAt = 'The end date cannot be before the start date';
        if (Object.keys(e).length) { setErrors(e); showToast(Object.values(e)[0]); return; }
        setSaving(true);
        const body = {
            kind: v.kind, title: v.title.trim(), subtitle: v.subtitle.trim(), image: v.image || '', productIds: v.productIds,
            startsAt: isoOfYmd(v.startsAt) ?? null, endsAt: isoOfYmd(v.endsAt, true) ?? null, isActive: v.isActive,
        };
        try {
            if (id) await collectionsApi.update(id, body); else await collectionsApi.create(body);
            showToast(id ? tr('Collection saved') : tr('Collection added'));
            nav.goBack();
        } catch (err) { useOwnerStore.getState().noteError(err); showToast(apiError(err)); } finally { setSaving(false); }
    };

    const remove = async () => {
        const yes = await ask({ title: tr('Delete this collection?'), message: tr('The items stay in your menu. Only this group is removed.'), confirmText: tr('Delete'), destructive: true });
        if (!yes) return;
        try { await collectionsApi.remove(id); showToast(tr('Collection deleted')); nav.goBack(); }
        catch (err) { useOwnerStore.getState().noteError(err); showToast(apiError(err)); }
    };

    return (
        <FormPage title={id ? tr('Edit collection') : tr('New collection')} footer={<Button label={id ? tr('Save changes') : tr('Add collection')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('Collection')}>
                <ChoiceBox label={tr('Kind')} hint={tr('Festival: special items for an occasion. Combo: meal deals.')} options={[['festival', tr('Festival')], ['combo', tr('Combo')]]} value={v.kind} onChange={(x) => set('kind', x)} />
                <TextBox label={tr('Title')} value={v.title} onChangeText={(x) => set('title', x)} error={errors.title} maxLength={60} placeholder={tr('e.g. Diwali Gift Boxes')} />
                <TextBox label={tr('Subtitle (optional)')} value={v.subtitle} onChangeText={(x) => set('subtitle', x)} maxLength={120} />
                <ImageField value={v.image} onChange={(x) => set('image', x)} kind="collection" last />
            </Group>

            <Group title={tr('Items ({length}/{MAX_ITEMS})', { length: v.productIds.length, MAX_ITEMS: MAX_ITEMS })} hint={tr('Pick from your existing items. A combo is a normal item with its own price.')}>
                {v.productIds.length ? v.productIds.map((pid, i) => {
                    const p = byId.get(pid);
                    return (
                        <View key={pid} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: i ? 0.5 : 0, borderTopColor: border }}>
                            {p ? <VegMark isVeg={p.isVeg} size={12} /> : <View style={{ width: 12 }} />}
                            <Text style={{ flex: 1, color: p ? text : muted, fontWeight: '700', marginLeft: 10 }} numberOfLines={1}>{p ? p.name : tr('Removed item')}</Text>
                            {p ? <Text style={{ color: muted, marginRight: 10 }}>{money(p.price)}</Text> : null}
                            <Pressable hitSlop={8} onPress={() => set('productIds', v.productIds.filter((x) => x !== pid))}><Ionicons name="close-circle" size={22} color={muted} /></Pressable>
                        </View>
                    );
                }) : <Hint>{tr('No items yet.')}</Hint>}
                <View style={{ marginTop: 12 }}><Button label={tr('Choose items')} kind="ghost" icon="restaurant-outline" onPress={() => setPicker(true)} /></View>
            </Group>

            <Group title={tr('When')} hint={tr('Optional. Outside these dates the collection is not shown.')}>
                <DateBox label={tr('Starts on')} value={v.startsAt} onChange={(x) => set('startsAt', x)} />
                <DateBox label={tr('Ends on')} value={v.endsAt} onChange={(x) => set('endsAt', x)} last />
                {errors.endsAt ? <Hint tone="warn">{errors.endsAt}</Hint> : null}
            </Group>

            <Group title={tr('Show it')}>
                <ToggleRow title={tr('Visible to customers')} value={v.isActive} onValueChange={(x) => set('isActive', x)} last />
            </Group>

            {id ? <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label={tr('Delete this collection')} kind="danger" icon="trash" onPress={remove} /></View> : null}

            <ItemPicker visible={picker} onClose={() => setPicker(false)} selected={v.productIds} onDone={(ids) => set('productIds', ids)} />
        </FormPage>
    );
}
