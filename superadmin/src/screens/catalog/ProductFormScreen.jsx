import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card, Badge } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, Choice, NumberField, Switch, Hint, TextField } from '../../components/settingsForm';
import { ImageField } from '../../components/catalogBits';
import OptionGroupsEditor, { withIds } from '../../components/optionGroups';
import { Loading, ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import useRecordForm from '../../hooks/useRecordForm';
import { listRecords, setStock } from '../../api/catalogApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { nameOf } from '../../utils/settings';

const GST = [0, 0.25, 3, 5, 12, 18, 28];
const SPICE = [['none', 'No spice'], ['mild', 'Mild'], ['medium', 'Medium'], ['hot', 'Hot']];

const BLANK = {
    categoryId: '', name: '', description: '', image: '', price: undefined, mrp: undefined,
    isVeg: undefined, isEggless: false, isSugarFree: false, isJain: false, spiceLevel: 'none',
    isBestseller: false, isNewArrival: false, isGiftPack: false, serves: undefined, calories: undefined, prepTimeMin: undefined,
    gstRate: undefined, optionGroups: [], isAvailable: true, isActive: true, sortOrder: 0,
};

const fromRecord = (r) => ({
    categoryId: r.categoryId ? String(r.categoryId) : '',
    name: r.name || '', description: r.description || '', image: r.image || '',
    price: r.price, mrp: r.mrp,
    isVeg: r.isVeg, isEggless: !!r.isEggless, isSugarFree: !!r.isSugarFree, isJain: !!r.isJain, spiceLevel: r.spiceLevel || 'none',
    isBestseller: !!r.isBestseller, isNewArrival: !!r.isNewArrival, isGiftPack: !!r.isGiftPack,
    serves: r.serves, calories: r.calories, prepTimeMin: r.prepTimeMin,
    gstRate: r.gstRate,
    optionGroups: (r.optionGroups || []).map((g) => ({ ...g, options: (g.options || []).map((o) => ({ ...o })) })),
    isAvailable: r.isAvailable !== false, isActive: r.isActive !== false, sortOrder: r.sortOrder || 0,
});

// One menu item: basics, price, food type, selling flags, choices (sizes, add-ons...), availability and stock.
export default function ProductFormScreen() {
    const t = useTheme();
    const { shopId, name: shopName, id } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const [cats, setCats] = useState(null);
    const [confirmOff, setConfirmOff] = useState(false);
    const [stock, setStockState] = useState(null);   // { enabled, qty } once the item is loaded
    const [savingStock, setSavingStock] = useState(false);
    const refId = useMemo(() => id || `n${Date.now().toString(36)}`, [id]);   // new item: a temporary name for its picture

    useEffect(() => {
        if (!rec) useShopStore.getState().load(shopId, { quiet: true });
        listRecords(shopId, 'categories', { limit: 100, active: 'true' }).then((r) => setCats(r.items)).catch(() => setCats([]));
    }, [shopId, rec]);

    const foodMode = rec?.resolved?.home?.foodMode;

    const f = useRecordForm({
        shopId, resource: 'products', id, blank: BLANK, fromRecord,
        validate: (v) => {
            const e = {};
            if (!v.categoryId) e.categoryId = 'Pick a category';
            if (!v.name.trim()) e.name = 'Enter the item name';
            if (v.price === undefined || v.price < 0) e.price = 'Enter the price';
            if (typeof v.isVeg !== 'boolean') e.isVeg = 'Choose veg or non-veg';
            if (v.mrp !== undefined && v.price !== undefined && v.mrp < v.price) e.mrp = 'MRP cannot be lower than the price';
            if (v.isJain && v.isVeg === false) e.isJain = 'A Jain item must be veg';
            v.optionGroups.forEach((g, i) => {
                if (!g.name.trim()) e.optionGroups = `Choice group ${i + 1} needs a question`;
                else if (!g.options.length || g.options.some((o) => !o.name.trim())) e.optionGroups = `Choice group ${i + 1}: every option needs a name`;
            });
            return e;
        },
        toBody: (v) => ({
            categoryId: v.categoryId,
            name: v.name.trim(),
            description: v.description.trim(),
            image: v.image || '',
            price: v.price,
            mrp: v.mrp ?? null,
            isVeg: v.isVeg,
            isEggless: v.isEggless,
            isSugarFree: v.isSugarFree,
            isJain: v.isJain,
            spiceLevel: v.spiceLevel,
            isBestseller: v.isBestseller,
            isNewArrival: v.isNewArrival,
            isGiftPack: v.isGiftPack,
            serves: v.serves ?? null,
            calories: v.calories ?? null,
            prepTimeMin: v.prepTimeMin ?? null,
            gstRate: v.gstRate ?? null,
            optionGroups: withIds(v.optionGroups),
            isAvailable: v.isAvailable,
            isActive: v.isActive,
            sortOrder: v.sortOrder || 0,
        }),
        label: id ? 'Item saved' : 'Item added',
    });

    useEffect(() => { if (f.record) setStockState({ enabled: !!f.record.stock?.enabled, qty: f.record.stock?.qty || 0 }); }, [f.record]);

    if (!f.form || cats === null) return <Screen title="Item" subtitle={shopName}>{f.error ? <ErrorBox message={f.error} onRetry={f.reload} /> : <Loading />}</Screen>;
    const v = f.form;

    const saveStock = async () => {
        setSavingStock(true);
        try {
            const r = await setStock(shopId, id, { enabled: stock.enabled, qty: Math.max(0, Math.floor(stock.qty || 0)) });
            f.set('isAvailable', r.isAvailable);
            toast('Stock saved');
        } catch (e) { toast(errMsg(e), 'error'); } finally { setSavingStock(false); }
    };

    const foodHint = foodMode === 'veg'
        ? 'This is a veg-only shop: non-veg items are not allowed.'
        : foodMode === 'eggless' ? 'This is an eggless shop: every item must be eggless.' : null;

    return (
        <Screen
            title={f.isNew ? 'New item' : 'Edit item'}
            subtitle={shopName}
            footer={<Button title={f.isNew ? 'Add item' : 'Save changes'} icon="check" onPress={f.save} loading={f.saving} />}
        >
            <Card>
                <Choice
                    label="Category"
                    options={cats.map((c) => ({ value: String(c._id), label: c.name }))}
                    value={v.categoryId}
                    onChange={(x) => f.set('categoryId', x)}
                />
                {f.errors.categoryId ? <Hint tone="warn">{f.errors.categoryId}</Hint> : null}
                {!cats.length ? <Hint tone="warn">This shop has no category yet. Add a category first (Menu → Categories).</Hint> : null}
                <View style={{ height: spacing.md }} />
                <Field label="Item name" value={v.name} onChangeText={(x) => f.set('name', x)} error={f.errors.name} maxLength={80} placeholder="e.g. Paneer Tikka" />
                <Field label="Description (optional)" value={v.description} onChangeText={(x) => f.set('description', x)} multiline maxLength={300} />
                <ImageField value={v.image} onChange={(x) => f.set('image', x)} shopId={shopId} kind="product" refId={refId} last />
            </Card>

            <Group title="Price" section="money">
                <NumberField label="Selling price" prefix="₹" value={v.price} onChange={(x) => f.set('price', x)} hint={f.errors.price} />
                <NumberField label="MRP (price before discount, optional)" prefix="₹" value={v.mrp} onChange={(x) => f.set('mrp', x)} hint={f.errors.mrp} />
                <Choice
                    label="GST rate"
                    hint="Empty = the shop's rate"
                    options={[{ value: 'shop', label: 'Shop rate' }, ...GST.map((g) => ({ value: g, label: `${g}%` }))]}
                    value={v.gstRate ?? 'shop'}
                    onChange={(x) => f.set('gstRate', x === 'shop' ? undefined : x)}
                    last
                />
            </Group>

            <Group title="Food type" section="catalog">
                <Choice
                    label="Veg or non-veg"
                    options={[{ value: true, label: 'Veg' }, { value: false, label: 'Non-veg' }]}
                    value={v.isVeg}
                    onChange={(x) => f.set('isVeg', x)}
                />
                {f.errors.isVeg ? <Hint tone="warn">{f.errors.isVeg}</Hint> : null}
                {foodHint ? <Hint>Shop food mode: {nameOf('foodMode', foodMode)}. {foodHint}</Hint> : null}
                <View style={{ height: spacing.md }} />
                <Switch title="Eggless" value={v.isEggless} onValueChange={(x) => f.set('isEggless', x)} />
                <Switch title="Sugar free" value={v.isSugarFree} onValueChange={(x) => f.set('isSugarFree', x)} />
                <Switch title="Jain" subtitle="Must be veg" value={v.isJain} onValueChange={(x) => f.set('isJain', x)} last />
                {f.errors.isJain ? <Hint tone="warn">{f.errors.isJain}</Hint> : null}
                <View style={{ height: spacing.lg }} />
                <Choice label="Spice level" options={SPICE.map(([value, label]) => ({ value, label }))} value={v.spiceLevel} onChange={(x) => f.set('spiceLevel', x)} last />
            </Group>

            <Group title="Details and labels" section="orders">
                <View style={{ flexDirection: 'row', gap: spacing.md }}>
                    <NumberField style={{ flex: 1 }} label="Serves" integer value={v.serves} onChange={(x) => f.set('serves', x)} />
                    <NumberField style={{ flex: 1 }} label="Calories" integer value={v.calories} onChange={(x) => f.set('calories', x)} />
                </View>
                <NumberField label="Preparation time" suffix="min" integer value={v.prepTimeMin} onChange={(x) => f.set('prepTimeMin', x)} />
                <Switch title="Bestseller" value={v.isBestseller} onValueChange={(x) => f.set('isBestseller', x)} />
                <Switch title="New arrival" value={v.isNewArrival} onValueChange={(x) => f.set('isNewArrival', x)} />
                <Switch title="Gift pack" value={v.isGiftPack} onValueChange={(x) => f.set('isGiftPack', x)} last />
            </Group>

            <Group title="Choices (sizes, add-ons, extras)" section="settings" hint="What the customer picks on this item. A price is an EXTRA on top of the selling price.">
                <OptionGroupsEditor value={v.optionGroups} onChange={(x) => f.set('optionGroups', x)} />
                {f.errors.optionGroups ? <Hint tone="warn">{f.errors.optionGroups}</Hint> : null}
            </Group>

            <Group title="Availability" section="riders" flush>
                <Switch title="In stock" subtitle="Switch off when the item runs out for today" value={v.isAvailable} onValueChange={(x) => f.set('isAvailable', x)} />
                <Switch title="Visible to customers" subtitle="Switch off to remove it from the menu" value={v.isActive} onValueChange={(x) => f.set('isActive', x)} last />
            </Group>

            {!f.isNew && stock ? (
                <Group title="Stock count" section="riders" hint="Optional. The item goes out of stock by itself when the count reaches 0.">
                    <Switch title="Count stock" value={stock.enabled} onValueChange={(x) => setStockState({ ...stock, enabled: x })} last={!stock.enabled} />
                    {stock.enabled ? (
                        <>
                            <View style={{ height: spacing.md }} />
                            <NumberField label="Pieces left" integer value={stock.qty} onChange={(x) => setStockState({ ...stock, qty: x ?? 0 })} last />
                        </>
                    ) : null}
                    <Button title="Save stock" kind="soft" small style={{ marginTop: spacing.md }} loading={savingStock} onPress={saveStock} />
                </Group>
            ) : null}

            <Group title="Position" section="catalog">
                <NumberField label="Order in the category" integer hint="Smaller numbers come first" value={v.sortOrder} onChange={(x) => f.set('sortOrder', x ?? 0)} last />
            </Group>

            {!f.isNew ? (
                <Button title="Remove this item" kind="dangerSoft" icon="trash" style={{ marginTop: spacing.xl }} onPress={() => setConfirmOff(true)} />
            ) : null}

            <ConfirmSheet
                visible={confirmOff}
                onClose={() => setConfirmOff(false)}
                title="Remove this item?"
                message="It disappears from the customer app. Past orders keep it. You can switch it back on by editing the item."
                confirmLabel="Remove item"
                danger
                onConfirm={f.remove}
            />
        </Screen>
    );
}
