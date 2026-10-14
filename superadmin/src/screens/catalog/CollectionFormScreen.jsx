import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, Choice, NumberField, Switch, Hint } from '../../components/settingsForm';
import { ImageField, DateField, VegMark } from '../../components/catalogBits';
import ProductPicker from '../../components/productPicker';
import { Loading, ErrorBox, ConfirmSheet } from '../../components/feedback';
import Icon from '../../components/Icon';
import useRecordForm from '../../hooks/useRecordForm';
import { getRecord } from '../../api/catalogApi';
import { ymdOf, isoOfYmd, rupees } from '../../utils/format';

const BLANK = { kind: 'festival', title: '', subtitle: '', image: '', productIds: [], startsAt: '', endsAt: '', sortOrder: 0, isActive: true };
const MAX_ITEMS = 30;

export default function CollectionFormScreen() {
    const t = useTheme();
    const { shopId, name: shopName, id } = useRoute().params;
    const [picker, setPicker] = useState(false);
    const [known, setKnown] = useState({});          // product id -> product (for names)
    const [confirmDel, setConfirmDel] = useState(false);

    const f = useRecordForm({
        shopId, resource: 'collections', id, blank: BLANK,
        fromRecord: (r) => ({
            kind: r.kind || 'festival', title: r.title || '', subtitle: r.subtitle || '', image: r.image || '',
            productIds: (r.productIds || []).map(String), startsAt: ymdOf(r.startsAt), endsAt: ymdOf(r.endsAt),
            sortOrder: r.sortOrder || 0, isActive: r.isActive !== false,
        }),
        validate: (v) => {
            const e = {};
            if (!v.title.trim()) e.title = 'Enter a title';
            if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) e.endsAt = 'The end date cannot be before the start date';
            return e;
        },
        toBody: (v) => ({
            kind: v.kind, title: v.title.trim(), subtitle: v.subtitle.trim(), image: v.image || '',
            productIds: v.productIds,
            startsAt: isoOfYmd(v.startsAt) ?? null,
            endsAt: isoOfYmd(v.endsAt, true) ?? null,
            sortOrder: v.sortOrder || 0, isActive: v.isActive,
        }),
        label: id ? 'Collection saved' : 'Collection added',
    });

    // names of the items already in the collection
    useEffect(() => {
        const ids = f.form?.productIds || [];
        const need = ids.filter((x) => !known[x]);
        if (!need.length) return;
        let alive = true;
        Promise.all(need.map((x) => getRecord(shopId, 'products', x).catch(() => null))).then((rows) => {
            if (!alive) return;
            setKnown((k) => ({ ...k, ...Object.fromEntries(rows.filter(Boolean).map((p) => [String(p._id), p])) }));
        });
        return () => { alive = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [f.form?.productIds?.join(',')]);

    if (!f.form) return <Screen title="Collection" subtitle={shopName}>{f.error ? <ErrorBox message={f.error} onRetry={f.reload} /> : <Loading />}</Screen>;
    const v = f.form;

    return (
        <Screen
            title={f.isNew ? 'New collection' : 'Edit collection'}
            subtitle={shopName}
            footer={<Button title={f.isNew ? 'Add collection' : 'Save changes'} icon="check" onPress={f.save} loading={f.saving} />}
        >
            <Card>
                <Choice
                    label="Kind"
                    hint="Festival: special items for an occasion. Combo: meal deals."
                    options={[{ value: 'festival', label: 'Festival' }, { value: 'combo', label: 'Combo' }]}
                    value={v.kind}
                    onChange={(x) => f.set('kind', x)}
                />
                <Field label="Title" value={v.title} onChangeText={(x) => f.set('title', x)} error={f.errors.title} maxLength={60} placeholder="e.g. Diwali Gift Boxes" />
                <Field label="Subtitle (optional)" value={v.subtitle} onChangeText={(x) => f.set('subtitle', x)} maxLength={120} />
                <ImageField value={v.image} onChange={(x) => f.set('image', x)} shopId={shopId} kind="collection" last />
            </Card>

            <Group title={`Items (${v.productIds.length}/${MAX_ITEMS})`} section="catalog" hint="Pick from the shop's existing items. A combo is a normal item with its own price.">
                {v.productIds.length ? v.productIds.map((pid, i) => {
                    const p = known[pid];
                    return (
                        <View key={pid} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                            {p ? <VegMark isVeg={p.isVeg} /> : <View style={{ width: 14 }} />}
                            <View style={{ flex: 1, marginLeft: spacing.md }}>
                                <Text style={{ color: t.text, fontWeight: '700' }} numberOfLines={1}>{p ? p.name : 'Loading…'}</Text>
                                {p ? <Text style={{ color: t.muted, fontSize: font.sm }}>{rupees(p.price)}</Text> : null}
                            </View>
                            <Pressable hitSlop={8} onPress={() => f.set('productIds', v.productIds.filter((x) => x !== pid))}>
                                <Icon name="clear" size={22} color={t.muted} />
                            </Pressable>
                        </View>
                    );
                }) : <Hint>No items yet.</Hint>}
                <Button title="Choose items" kind="soft" icon="food" style={{ marginTop: spacing.md }} onPress={() => setPicker(true)} />
            </Group>

            <Group title="When" section="orders" hint="Optional. Outside these dates the collection is not shown.">
                <DateField label="Starts on" value={v.startsAt} onChange={(x) => f.set('startsAt', x)} />
                <DateField label="Ends on" value={v.endsAt} onChange={(x) => f.set('endsAt', x)} last />
                {f.errors.endsAt ? <Hint tone="warn">{f.errors.endsAt}</Hint> : null}
            </Group>

            <Group title="Show it" section="riders" flush>
                <Switch title="Visible to customers" value={v.isActive} onValueChange={(x) => f.set('isActive', x)} last />
            </Group>
            <Group title="Position" section="catalog">
                <NumberField label="Order on the home screen" integer hint="Smaller numbers come first" value={v.sortOrder} onChange={(x) => f.set('sortOrder', x ?? 0)} last />
            </Group>

            {!f.isNew ? <Button title="Delete this collection" kind="dangerSoft" icon="trash" style={{ marginTop: spacing.xl }} onPress={() => setConfirmDel(true)} /> : null}

            <ProductPicker
                visible={picker}
                onClose={() => setPicker(false)}
                shopId={shopId}
                selected={v.productIds}
                max={MAX_ITEMS}
                onDone={(ids, prods) => { setKnown((k) => ({ ...k, ...prods })); f.set('productIds', ids); }}
            />
            <ConfirmSheet
                visible={confirmDel}
                onClose={() => setConfirmDel(false)}
                title="Delete this collection?"
                message="The items stay in the shop. Only this group is removed."
                confirmLabel="Delete"
                danger
                onConfirm={f.remove}
            />
        </Screen>
    );
}
