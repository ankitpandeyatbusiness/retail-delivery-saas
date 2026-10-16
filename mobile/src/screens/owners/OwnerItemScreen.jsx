// One menu item: what it is, name and picture, price, veg/non-veg, labels, choices (sizes, add-ons), daily stock.
// Opened with params { id } to edit, or { categoryId? } to add. A new category can simply be typed.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Empty, Button } from '../../components/owners/ui';
import {
    FormPage, Group, TextBox, NumberBox, ChoiceBox, ToggleRow, Hint, Label, ImageField, OptionGroupsEditor, MeasureEditor,
} from '../../components/owners/menuBits';
import { products, setStock, apiError } from '../../api/owners/shopApi';
import { useMenuStore } from '../../store/owners/useMenuStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { BLANK_ITEM, itemFromRecord, itemProblems, itemBody, stockUnit, titleCase, amountLabel, SPICE } from '../../utils/owners/menuRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';

const FOOD_MODES = {
    veg: 'This is a veg-only shop: non-veg items are not allowed.',
    eggless: 'This is an eggless shop: every item must be eggless.',
};

export default function OwnerItemScreen() {
    const nav = useNavigation();
    const { id, categoryId } = useRoute().params || {};
    const { muted } = useBrand();
    const cats = useMenuStore((s) => s.categories);
    const options = useMenuStore((s) => s.options);
    const [form, setForm] = useState(id ? null : { ...BLANK_ITEM, categoryId: categoryId || '' });
    const [record, setRecord] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [errors, setErrors] = useState({});
    const [saving, setSaving] = useState(false);
    const [stock, setStockState] = useState(null);
    const [savingStock, setSavingStock] = useState(false);
    const refId = useMemo(() => id || `n${Date.now().toString(36)}`, [id]);   // a new item's picture needs a temporary name

    useEffect(() => {
        const st = useMenuStore.getState();
        st.loadOptions();
        if (!st.loadedAt) st.load({ quiet: true });
    }, []);

    useEffect(() => {
        if (!id) return;
        let alive = true;
        products.get(id).then((r) => {
            if (!alive) return;
            setRecord(r);
            setForm(itemFromRecord(r));
            setStockState({ enabled: !!r.stock?.enabled, qty: r.stock?.qty || 0, dailyQty: Number.isFinite(r.stock?.dailyQty) ? r.stock.dailyQty : undefined });
        }).catch((e) => { useOwnerStore.getState().noteError(e); if (alive) setLoadError(apiError(e, 'Could not open this item.')); });
        return () => { alive = false; };
    }, [id]);

    const set = (k, v) => { setForm((f) => ({ ...f, [k]: v })); setErrors((e) => (e[k] ? { ...e, [k]: undefined } : e)); };

    if (!form) {
        return (
            <FormPage title="Item">
                {loadError ? <Empty icon="cloud-offline-outline" title="Could not open this item" hint={loadError} /> : <FormShimmer />}
            </FormPage>
        );
    }
    const v = form;
    const kinds = options?.itemKinds || [];
    const presets = options?.measures?.[v.sellBy]?.presets || [250, 500, 1000];
    const unit = stockUnit(v.sellBy);
    const foodHint = FOOD_MODES[options?.foodMode];

    const save = async () => {
        const problems = itemProblems(v);
        if (Object.keys(problems).length) { setErrors(problems); showToast(Object.values(problems)[0]); return; }
        setSaving(true);
        try {
            if (id) await products.update(id, itemBody(v)); else await products.create(itemBody(v));
            showToast(id ? 'Item saved' : 'Item added');
            useMenuStore.getState().load({ quiet: true });
            nav.goBack();
        } catch (e) {
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
        } finally { setSaving(false); }
    };

    const saveStock = async () => {
        setSavingStock(true);
        try {
            await setStock(id, {
                enabled: stock.enabled,
                qty: Math.max(0, Math.floor(stock.qty || 0)),
                dailyQty: stock.dailyQty === undefined ? null : Math.max(0, Math.floor(stock.dailyQty)),
            });
            showToast('Stock saved');
            useMenuStore.getState().load({ quiet: true });
        } catch (e) { showToast(apiError(e)); } finally { setSavingStock(false); }
    };

    const remove = async () => {
        const yes = await ask({ title: 'Remove this item?', message: 'It disappears from the customer app. Past orders keep it.', confirmText: 'Remove item', destructive: true });
        if (!yes) return;
        try {
            await products.remove(id);
            showToast('Item removed');
            useMenuStore.getState().load({ quiet: true });
            nav.goBack();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const typedCat = v.newCategory.trim();
    const sameCat = typedCat ? cats.find((c) => c.name.trim().toLowerCase() === titleCase(typedCat).toLowerCase()) : null;

    return (
        <FormPage title={id ? 'Edit item' : 'New item'} footer={<Button label={id ? 'Save changes' : 'Add item'} icon="checkmark" busy={saving} onPress={save} />}>
            {kinds.length ? (
                <Group title="What is it" hint="The kind puts the item in the right category by itself and sets how it is usually sold.">
                    <ChoiceBox
                        label="Kind of item"
                        options={kinds.map((k) => [k.id, k.label])}
                        value={v.itemKind}
                        onChange={(x) => {
                            set('itemKind', x === v.itemKind ? '' : x);
                            const k = kinds.find((y) => y.id === x);
                            if (k && x !== v.itemKind && (!id || v.sellBy === 'piece')) set('sellBy', k.sellBy);
                        }}
                    />
                    <ChoiceBox
                        label="How is it sold"
                        options={[['piece', 'By piece'], ['weight', 'By weight'], ['volume', 'By volume']]}
                        value={v.sellBy}
                        onChange={(x) => set('sellBy', x)}
                        last
                    />
                    {v.sellBy !== 'piece' ? <Hint>The customer picks an amount, so there is no quantity or size. Enter the price for 1 {v.sellBy === 'volume' ? 'litre' : 'kg'} below.</Hint> : null}
                </Group>
            ) : null}

            {v.sellBy !== 'piece' ? (
                <Group title="Amounts the customer can pick">
                    <MeasureEditor sellBy={v.sellBy} value={v.measure} presets={presets} onChange={(m) => set('measure', m)} error={errors.measure} />
                </Group>
            ) : null}

            <Group title="Category and name">
                <ChoiceBox
                    label={v.itemKind ? 'Category (leave empty to file it by kind)' : 'Category'}
                    options={cats.filter((c) => c.isActive !== false || String(c._id) === v.categoryId).map((c) => [String(c._id), c.name])}
                    value={v.categoryId}
                    onChange={(x) => { set('categoryId', x === v.categoryId ? '' : x); if (x) set('newCategory', ''); }}
                    error={errors.categoryId}
                />
                <TextBox
                    label="Or type a new category"
                    value={v.newCategory}
                    onChangeText={(x) => { set('newCategory', x); if (x.trim()) set('categoryId', ''); }}
                    error={errors.newCategory}
                    maxLength={40}
                    placeholder="e.g. rice"
                    hint={typedCat ? (sameCat ? `"${sameCat.name}" already exists, this item will go into it.` : `A new category "${titleCase(typedCat)}" will be created.`) : undefined}
                />
                <TextBox label="Item name" value={v.name} onChangeText={(x) => set('name', x)} error={errors.name} maxLength={80} placeholder="e.g. Paneer Tikka" />
                <TextBox label="Description (optional)" value={v.description} onChangeText={(x) => set('description', x)} multiline maxLength={300} />
                <ImageField value={v.image} onChange={(x) => set('image', x)} kind="product" refId={refId} last />
            </Group>

            <Group title="Price" hint="GST is added by the platform, only if your shop has a GST number.">
                <NumberBox
                    label={v.sellBy === 'weight' ? 'Price per kg' : v.sellBy === 'volume' ? 'Price per litre' : 'Selling price'}
                    prefix="₹" value={v.price} onChange={(x) => set('price', x)}
                    error={errors.price}
                    hint={v.sellBy !== 'piece' && v.price ? `${amountLabel(v.sellBy, 250)} costs ₹${Math.round(v.price / 4 * 100) / 100}` : undefined}
                />
                <NumberBox label="MRP (price before discount, optional)" prefix="₹" value={v.mrp} onChange={(x) => set('mrp', x)} error={errors.mrp} last />
            </Group>

            <Group title="Food type">
                <ChoiceBox label="Veg or non-veg" options={[[true, 'Veg'], [false, 'Non-veg']]} value={v.isVeg} onChange={(x) => set('isVeg', x)} error={errors.isVeg} />
                {foodHint ? <Hint>{foodHint}</Hint> : null}
                <View style={{ height: 8 }} />
                <ToggleRow title="Eggless" value={v.isEggless} onValueChange={(x) => set('isEggless', x)} />
                <ToggleRow title="Sugar free" value={v.isSugarFree} onValueChange={(x) => set('isSugarFree', x)} />
                <ToggleRow title="Jain" subtitle="Must be veg" value={v.isJain} onValueChange={(x) => set('isJain', x)} last />
                {errors.isJain ? <Hint tone="warn">{errors.isJain}</Hint> : null}
                <View style={{ height: 14 }} />
                <ChoiceBox label="Spice level" options={SPICE} value={v.spiceLevel} onChange={(x) => set('spiceLevel', x)} last />
            </Group>

            <Group title="Details and labels">
                <View style={{ flexDirection: 'row' }}>
                    {v.sellBy === 'piece' ? <NumberBox style={{ flex: 1, marginRight: 10 }} label="Serves" integer value={v.serves} onChange={(x) => set('serves', x)} /> : null}
                    <NumberBox style={{ flex: 1 }} label="Calories" integer value={v.calories} onChange={(x) => set('calories', x)} />
                </View>
                <NumberBox label="Preparation time" suffix="min" integer value={v.prepTimeMin} onChange={(x) => set('prepTimeMin', x)} />
                <ToggleRow title="Bestseller" value={v.isBestseller} onValueChange={(x) => set('isBestseller', x)} />
                <ToggleRow title="New arrival" value={v.isNewArrival} onValueChange={(x) => set('isNewArrival', x)} />
                <ToggleRow title="Gift pack" value={v.isGiftPack} onValueChange={(x) => set('isGiftPack', x)} last />
            </Group>

            <Group title="Choices (sizes, add-ons)" hint="What the customer picks on this item. A price here is an EXTRA on top of the selling price.">
                <OptionGroupsEditor value={v.optionGroups} onChange={(x) => set('optionGroups', x)} />
                {errors.optionGroups ? <Hint tone="warn">{errors.optionGroups}</Hint> : null}
            </Group>

            {id && stock ? (
                <Group title="Daily stock" hint="Off = unlimited. With a limit on, customers see Few left when it runs low, the item goes out of stock at 0, and every new day starts again with the daily amount.">
                    <ToggleRow title="Limit the stock" subtitle={stock.enabled ? undefined : 'Unlimited'} value={stock.enabled} onValueChange={(x) => setStockState({ ...stock, enabled: x })} last={!stock.enabled} />
                    {stock.enabled ? (
                        <View style={{ marginTop: 14 }}>
                            <NumberBox
                                label={`Every day starts with (${unit.suffix})`}
                                integer={unit.integer} suffix={unit.suffix} placeholder="Optional"
                                value={unit.show(stock.dailyQty)}
                                hint="Optional. Empty: only the count below, changed by hand and by orders."
                                onChange={(x) => {
                                    const base = x === undefined ? undefined : unit.fromUi(x);
                                    setStockState({ ...stock, dailyQty: base, qty: base !== undefined && !stock.qty ? base : stock.qty });
                                }}
                            />
                            <NumberBox
                                label={`Left right now (${unit.suffix})`}
                                integer={unit.integer} suffix={unit.suffix}
                                value={unit.show(stock.qty)}
                                onChange={(x) => setStockState({ ...stock, qty: x === undefined ? 0 : unit.fromUi(x) })}
                                last
                            />
                        </View>
                    ) : null}
                    <View style={{ marginTop: 14 }}><Button label="Save stock" kind="ghost" busy={savingStock} onPress={saveStock} /></View>
                </Group>
            ) : null}

            <Group title="Show it" hint="Switch off to take the item off the customer menu without removing it.">
                <ToggleRow title="Visible to customers" value={v.isActive} onValueChange={(x) => set('isActive', x)} last />
            </Group>

            {id ? <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label="Remove this item" kind="danger" icon="trash" onPress={remove} /></View> : null}
        </FormPage>
    );
}
