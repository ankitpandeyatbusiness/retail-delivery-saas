import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Card, Badge, SectionTitle } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, Choice, NumberField, Switch, Hint, TextField } from '../../components/settingsForm';
import { ImageField } from '../../components/catalogBits';
import OptionGroupsEditor, { withIds } from '../../components/optionGroups';
import { Loading, ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import useRecordForm from '../../hooks/useRecordForm';
import { listRecords, setStock } from '../../api/catalogApi';
import { fetchOptions } from '../../api/shopsApi';
import { MeasureEditor, amountLabel } from '../../components/measureEditor';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { nameOf } from '../../utils/settings';

const SPICE = [['none', 'No spice'], ['mild', 'Mild'], ['medium', 'Medium'], ['hot', 'Hot']];

const BLANK = {
    categoryId: '', name: '', description: '', image: '', price: undefined, mrp: undefined,
    isVeg: undefined, isEggless: false, isSugarFree: false, isJain: false, spiceLevel: 'none',
    isBestseller: false, isNewArrival: false, isGiftPack: false, serves: undefined, calories: undefined, prepTimeMin: undefined,
    optionGroups: [], isAvailable: true, isActive: true, sortOrder: 0,
    itemKind: '', sellBy: 'piece', measure: { options: [], min: undefined, allowManual: true },
};

const fromRecord = (r) => ({
    categoryId: r.categoryId ? String(r.categoryId) : '',
    name: r.name || '', description: r.description || '', image: r.image || '',
    price: r.price, mrp: r.mrp,
    isVeg: r.isVeg, isEggless: !!r.isEggless, isSugarFree: !!r.isSugarFree, isJain: !!r.isJain, spiceLevel: r.spiceLevel || 'none',
    isBestseller: !!r.isBestseller, isNewArrival: !!r.isNewArrival, isGiftPack: !!r.isGiftPack,
    serves: r.serves, calories: r.calories, prepTimeMin: r.prepTimeMin,
    optionGroups: (r.optionGroups || []).map((g) => ({ ...g, options: (g.options || []).map((o) => ({ ...o })) })),
    isAvailable: r.isAvailable !== false, isActive: r.isActive !== false, sortOrder: r.sortOrder || 0,
    itemKind: r.itemKind || '', sellBy: r.sellBy || 'piece',
    measure: { options: r.measure?.options || [], min: r.measure?.min, allowManual: r.measure?.allowManual !== false },
});

// One menu item: basics, price, food type, selling flags, choices (sizes, add-ons...), availability and stock.
export default function ProductFormScreen() {
    const t = useTheme();
    const { shopId, name: shopName, id } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const [cats, setCats] = useState(null);
    const [kinds, setKinds] = useState(null);       // what an item can be in this kind of business
    const [presets, setPresets] = useState({});     // quick sizes for weight and volume
    const [confirmOff, setConfirmOff] = useState(false);
    const [stock, setStockState] = useState(null);   // { enabled, qty } once the item is loaded
    const [savingStock, setSavingStock] = useState(false);
    const refId = useMemo(() => id || `n${Date.now().toString(36)}`, [id]);   // new item: a temporary name for its picture

    useEffect(() => {
        if (!rec) useShopStore.getState().load(shopId, { quiet: true });
        listRecords(shopId, 'categories', { limit: 100, active: 'true' }).then((r) => setCats(r.items)).catch(() => setCats([]));
        fetchOptions().then((o) => {
            const bt = o.businessTypes?.[rec?.tenant?.businessType || 'restaurant'] || o.businessTypes?.restaurant;
            setKinds(bt?.itemKinds || []);
            setPresets(bt?.measures || {});
        }).catch(() => setKinds([]));
    }, [shopId, rec]);

    const foodMode = rec?.resolved?.home?.foodMode;

    const f = useRecordForm({
        shopId, resource: 'products', id, blank: BLANK, fromRecord,
        validate: (v) => {
            const e = {};
            if (!v.categoryId && !v.itemKind) e.categoryId = 'Pick what the item is, or a category';
            if (v.sellBy !== 'piece' && v.measure.min !== undefined && v.measure.min < 10) e.measure = 'The smallest amount is at least 10';
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
            ...(v.categoryId ? { categoryId: v.categoryId } : {}),
            ...(v.itemKind ? { itemKind: v.itemKind } : {}),
            sellBy: v.sellBy,
            ...(v.sellBy !== 'piece' ? { measure: { options: v.measure.options, min: v.measure.min ?? undefined, allowManual: v.measure.allowManual } } : {}),
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
            optionGroups: withIds(v.optionGroups),
            isAvailable: v.isAvailable,
            isActive: v.isActive,
            sortOrder: v.sortOrder || 0,
        }),
        label: id ? 'Item saved' : 'Item added',
    });

    useEffect(() => { if (f.record) setStockState({ enabled: !!f.record.stock?.enabled, qty: f.record.stock?.qty || 0 }); }, [f.record]);

    if (!f.form || cats === null || kinds === null) return <Screen title="Item" subtitle={shopName}>{f.error ? <ErrorBox message={f.error} onRetry={f.reload} /> : <Loading />}</Screen>;
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
            <Group title="What is it" section="catalog" hint="The kind files the item in its menu category by itself, and sets how it is usually sold.">
                <Choice
                    label="Kind of item"
                    options={kinds.map((k) => ({ value: k.id, label: k.label }))}
                    value={v.itemKind}
                    onChange={(x) => {
                        f.set('itemKind', x);
                        const k = kinds.find((y) => y.id === x);
                        if (k && (f.isNew || v.sellBy === 'piece')) f.set('sellBy', k.sellBy);
                    }}
                />
                {f.errors.categoryId ? <Hint tone="warn">{f.errors.categoryId}</Hint> : null}
                <Choice
                    label="How is it sold"
                    options={[{ value: 'piece', label: 'By piece' }, { value: 'weight', label: 'By weight (kg / g)' }, { value: 'volume', label: 'By volume (L / ml)' }]}
                    value={v.sellBy}
                    onChange={(x) => f.set('sellBy', x)}
                    last
                />
                {v.sellBy !== 'piece' ? <Hint>The customer chooses an amount, so this item has no quantity, serves or size. Enter the price for 1 {v.sellBy === 'volume' ? 'litre' : 'kg'} below.</Hint> : null}
            </Group>
            {v.sellBy !== 'piece' ? (
                <Group title="Amounts the customer can pick" section="orders">
                    <MeasureEditor
                        sellBy={v.sellBy}
                        value={v.measure}
                        presets={(presets[v.sellBy] || {}).presets || [250, 500, 1000]}
                        onChange={(m) => f.set('measure', m)}
                        error={f.errors.measure}
                    />
                </Group>
            ) : null}

            <SectionTitle section="shops">Category and details</SectionTitle>
            <Card>
                <Choice
                    label={v.itemKind ? 'Category (leave empty to file it by kind)' : 'Category'}
                    options={[...(v.itemKind ? [{ value: '', label: 'Automatic' }] : []), ...cats.map((c) => ({ value: String(c._id), label: c.name }))]}
                    value={v.categoryId}
                    onChange={(x) => f.set('categoryId', x)}
                />
                {!cats.length ? <Hint tone="warn">This shop has no category yet. Add a category first (Menu → Categories).</Hint> : null}
                <View style={{ height: spacing.md }} />
                <Field label="Item name" value={v.name} onChangeText={(x) => f.set('name', x)} error={f.errors.name} maxLength={80} placeholder="e.g. Paneer Tikka" />
                <Field label="Description (optional)" value={v.description} onChangeText={(x) => f.set('description', x)} multiline maxLength={300} />
                <ImageField value={v.image} onChange={(x) => f.set('image', x)} shopId={shopId} kind="product" refId={refId} last />
            </Card>

            <Group title="Price" section="money">
                <NumberField label={v.sellBy === 'weight' ? 'Price per kg' : v.sellBy === 'volume' ? 'Price per litre' : 'Selling price'} prefix="₹" value={v.price} onChange={(x) => f.set('price', x)} hint={f.errors.price || (v.sellBy !== 'piece' && v.price ? `${amountLabel(v.sellBy, 250)} costs ₹${Math.round(v.price / 4 * 100) / 100}` : undefined)} />
                <NumberField label="MRP (price before discount, optional)" prefix="₹" value={v.mrp} onChange={(x) => f.set('mrp', x)} hint={f.errors.mrp} />
                <Hint>GST on this item is the platform's one rate, charged only if the shop has a GST number.</Hint>
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
                    {v.sellBy === 'piece' ? <NumberField style={{ flex: 1 }} label="Serves" integer value={v.serves} onChange={(x) => f.set('serves', x)} /> : null}
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

            {!f.isNew && stock && v.sellBy === 'piece' ? (
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
