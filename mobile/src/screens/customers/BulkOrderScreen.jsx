// Bulk order, step 1: the whole menu with a picture and a counter on every dish (and on every choice the owner made: Half, Full...).
// What he picks goes into the BULK ORDER cart (a bar at the bottom shows it). The rest (pickup or delivery, the day and time, the address, the
// instructions, who he is) is filled in on the cart page, like for a normal order. Nothing is paid here.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty, Sheet } from '../../components/owners/ui';
import { FormPage, Group, TextBox, VegMark } from '../../components/owners/menuBits';
import { FormShimmer } from '../../components/owners/shimmer';
import BulkCartBar from '../../components/customers/BulkCartBar';
import { showToast } from '../../components/customers/shop';
import { rs } from '../../components/customers/orders';
import { fetchBulkConfig, fetchBulkMenu } from '../../api/customers/shopApi';
import { useBulkCartStore, keyOfBulk, allowBulkStart } from '../../store/customers/useBulkCartStore';
import { tr } from '../../i18n';

const clean = (x, max) => Math.max(0, Math.min(max, Math.floor(Number(x) || 0)));

// one counter: minus, a number he can also type, plus (hold plus to add 10). min = the least he may order of this one: the minus stops there
// (a small ✕ takes the dish out), and the first tap on plus starts at the minimum.
export function Qty({ value, max, min = 0, onChange }) {
    const { text, border, primary, onPrimary, surface, muted } = useBrand();
    const btn = { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' };
    const atLeast = Math.max(0, min);
    const canMinus = value > atLeast && value > 0;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            {atLeast > 0 && value > 0 ? (
                <Pressable onPress={() => onChange(0)} hitSlop={8} accessibilityLabel={tr('Remove')} style={{ marginRight: 6 }}>
                    <Ionicons name="close-circle-outline" size={22} color={muted} />
                </Pressable>
            ) : null}
            <Pressable disabled={!canMinus} onPress={() => onChange(clean(value - 1, max))} style={[btn, { borderWidth: 1, borderColor: border, backgroundColor: surface, opacity: canMinus ? 1 : 0.4 }]}>
                <Ionicons name="remove" size={18} color={text} />
            </Pressable>
            <TextInput
                value={value ? String(value) : ''} placeholder={atLeast ? String(atLeast) : '0'} placeholderTextColor={border} keyboardType="number-pad" maxLength={5}
                onChangeText={(t) => onChange(clean(t.replace(/\D/g, ''), max))}
                onEndEditing={() => { if (value > 0 && value < atLeast) onChange(atLeast); }}   // typed too few: it goes up to the minimum
                style={{ minWidth: 52, textAlign: 'center', color: text, fontWeight: '900', fontSize: 16, paddingVertical: 4 }}
            />
            <Pressable
                onPress={() => onChange(value === 0 && atLeast ? atLeast : clean(value + 1, max))}
                onLongPress={() => onChange(clean((value === 0 && atLeast ? atLeast : value) + 10, max))}
                style={[btn, { backgroundColor: primary }]}
            >
                <Ionicons name="add" size={18} color={onPrimary} />
            </Pressable>
        </View>
    );
}

// the dish picture (or a plate when it has none)
export function Thumb({ uri, size = 56 }) {
    const { border, muted } = useBrand();
    return uri
        ? <Image source={{ uri }} style={{ width: size, height: size, borderRadius: 12 }} contentFit="cover" transition={150} />
        : <View style={{ width: size, height: size, borderRadius: 12, backgroundColor: border, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="fast-food-outline" size={size * 0.42} color={muted} /></View>;
}

export default function BulkOrderScreen() {
    const nav = useNavigation();
    const again = useRoute().params?.again;   // from Orders: an earlier bulk order to fill in again { fulfilment, lines: [{ productId, quantity, options, pick }] }
    const { text, muted, primary, border, ok } = useBrand();
    const [cfg, setCfg] = useState(null);
    const [menu, setMenu] = useState(null);
    const [err, setErr] = useState('');
    const [find, setFind] = useState('');
    const [sheet, setSheet] = useState(null);               // { item, picks } for a dish whose choices need more than one tap
    const lines = useBulkCartStore((s) => s.lines);

    useEffect(() => {
        Promise.all([fetchBulkConfig(), fetchBulkMenu()]).then(async ([c, m]) => {
            setCfg(c); setMenu(m.categories || []);
            const store = useBulkCartStore.getState();
            if (!c.pickup && c.delivery) store.setForm({ fulfilment: 'delivery' });
            if (again?.lines?.length) {
                // the same dishes and choices as before; a dish the shop no longer has is left out. Day, time and address are asked afresh.
                if (!(await allowBulkStart())) return;
                const items = new Map((m.categories || []).flatMap((x) => x.items).map((i) => [i.id, i]));
                let kept = 0;
                again.lines.forEach((l) => {
                    const it = items.get(l.productId);
                    if (!it) return;
                    kept += 1;
                    store.setQty(it, l.pick || [], (l.options || []).join(', ') || tr('Plain'), Math.min(l.quantity, c.maxQtyPerDish || 500), 0);
                });
                if (again.fulfilment === 'delivery' ? c.delivery : again.fulfilment === 'pickup' ? c.pickup : false) store.setForm({ fulfilment: again.fulfilment });
                if (kept < again.lines.length) showToast(tr('Some dishes are no longer on the menu and were left out'));
                if (kept) nav.replace('BulkCart');
            }
        }).catch((e) => setErr(e?.response?.data?.error || tr('Could not load the menu')));
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps

    const max = cfg?.maxQtyPerDish || 500;
    const qtyOf = (productId, selections) => lines.find((l) => l.key === keyOfBulk(productId, selections))?.quantity || 0;
    const piecesOf = (productId) => lines.filter((l) => l.productId === productId).reduce((n, l) => n + l.quantity, 0);
    const minOf = (item, option) => Math.max(0, Number(option?.minQty ?? item.minQty) || 0);   // (the owner sets it per choice)
    const setQty = async (item, selections, label, n, option) => {
        if (n > 0 && !lines.length && !(await allowBulkStart())) return;   // a normal cart is waiting: ask first
        useBulkCartStore.getState().setQty(item, selections, label, n, minOf(item, option));
    };

    if (!cfg || !menu) {
        return <FormPage title={tr('Bulk order')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    }
    if (!cfg.enabled) return <FormPage title={tr('Bulk order')}><Empty icon="cube-outline" title={tr('Not available')} hint={tr('This shop does not take bulk orders right now.')} /></FormPage>;
    // the owner paused bulk orders for a while: the service is still here, with a clear sentence, and no menu to pick from
    if (cfg.paused) {
        return (
            <FormPage title={tr('Bulk order')}>
                <Empty icon="pause-circle-outline" title={tr('Temporarily unavailable')} hint={`${tr('Sorry, this service is temporarily unavailable.')} ${tr('The shop is not taking new requests for now. Please check again later.')}`} />
                <View style={{ paddingHorizontal: 16 }}><Button label={tr('My bulk orders')} icon="receipt-outline" kind="ghost" onPress={() => nav.navigate('MyBulkOrders')} /></View>
            </FormPage>
        );
    }

    const shown = menu.map((c) => ({ ...c, items: c.items.filter((i) => !find.trim() || i.name.toLowerCase().includes(find.trim().toLowerCase())) })).filter((c) => c.items.length);
    const price = (i, o) => rs(i.price + (o?.price || 0));
    const oneChoice = (i) => i.optionGroups.length === 1 && i.optionGroups[0].max === 1 && i.optionGroups[0].min >= 1;

    const dish = (i) => {
        const bulkNote = i.bulk ? tr('{n} or more: {p}% off', { n: i.bulk.minQty, p: i.bulk.percentOff }) : '';
        const pieces = piecesOf(i.id);
        const got = i.bulk && pieces >= i.bulk.minQty;
        return (
            <View key={i.id} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Thumb uri={i.image} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <VegMark isVeg={i.isVeg} />
                            <Text numberOfLines={2} style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15, marginLeft: 8 }}>{i.name}</Text>
                        </View>
                        {!i.optionGroups.length ? <Text style={{ color: muted, fontWeight: '700', marginTop: 2 }}>{rs(i.price)}</Text> : null}
                        {bulkNote ? <Text style={{ color: got ? ok : primary, fontSize: 12, fontWeight: '800', marginTop: 2 }}>{got ? `✓ ${bulkNote}` : bulkNote}</Text> : null}
                    </View>
                </View>
                {!i.optionGroups.length ? (
                    <View style={{ alignItems: 'flex-end', marginTop: 8 }}><Qty value={qtyOf(i.id, [])} max={max} min={minOf(i)} onChange={(n) => setQty(i, [], '', n)} /></View>
                ) : oneChoice(i) ? i.optionGroups[0].options.filter((o) => o.isAvailable !== false).map((o) => {
                    const sel = [{ groupId: i.optionGroups[0].id, optionIds: [o.id] }];
                    return (
                        <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <Text style={{ flex: 1, color: text, fontSize: 14 }}>{o.name}  <Text style={{ color: muted }}>{price(i, o)}</Text>{minOf(i, o) ? <Text style={{ color: muted, fontSize: 12 }}>{`  · ${tr('min {n}', { n: minOf(i, o) })}`}</Text> : null}</Text>
                            <Qty value={qtyOf(i.id, sel)} max={max} min={minOf(i, o)} onChange={(n) => setQty(i, sel, o.name, n, o)} />
                        </View>
                    );
                }) : (
                    <>
                        {lines.filter((l) => l.productId === i.id).map((l) => (
                            <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                <Text style={{ flex: 1, color: text, fontSize: 13 }}>{l.label}</Text>
                                <Qty value={l.quantity} max={max} min={l.minQty || 0} onChange={(n) => useBulkCartStore.getState().setQty(i, l.selections, l.label, n, l.minQty || 0)} />
                            </View>
                        ))}
                        <Pressable onPress={() => setSheet({ item: i, picks: {} })} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <Ionicons name="add-circle-outline" size={18} color={primary} style={{ marginRight: 6 }} />
                            <Text style={{ color: primary, fontWeight: '800' }}>{tr('Choose options and add')}</Text>
                        </Pressable>
                    </>
                )}
            </View>
        );
    };

    // a dish with several questions: pick, then it becomes a line with its own counter
    const addPicked = () => {
        const { item, picks } = sheet;
        for (const g of item.optionGroups) {
            const n = (picks[g.id] || []).length;
            if (n < (g.min || 0)) return showToast(tr('Choose: {q}', { q: g.name }));
        }
        const selections = item.optionGroups.filter((g) => (picks[g.id] || []).length).map((g) => ({ groupId: g.id, optionIds: picks[g.id] }));
        const label = item.optionGroups.flatMap((g) => g.options.filter((o) => (picks[g.id] || []).includes(o.id)).map((o) => o.name)).join(', ') || tr('Plain');
        setQty(item, selections, label, Math.max(1, qtyOf(item.id, selections) + 1));
        setSheet(null);
    };
    const togglePick = (g, o) => setSheet((s) => {
        const now = s.picks[g.id] || [];
        const next = now.includes(o.id) ? now.filter((x) => x !== o.id) : g.max === 1 ? [o.id] : [...now, o.id].slice(-(g.max || 1));
        return { ...s, picks: { ...s.picks, [g.id]: next } };
    });

    const footer = lines.length
        ? <BulkCartBar inFooter />
        : <Text style={{ color: muted, textAlign: 'center', fontWeight: '700', paddingVertical: 6 }}>{tr('Pick dishes to start your bulk order')}</Text>;

    return (
        <FormPage title={tr('Bulk order')} footer={footer}>
            <Group title={tr('Pick the dishes')} hint={cfg.minOrderAmount ? tr('The minimum bulk order is {a}. Hold + to add 10 at a time, or type the number.', { a: rs(cfg.minOrderAmount) }) : tr('Hold + to add 10 at a time, or type the number.')}>
                <TextBox placeholder={tr('Search a dish')} value={find} onChangeText={setFind} maxLength={40} last />
                {shown.map((c) => (
                    <View key={c.id}>
                        <Text style={{ color: primary, fontWeight: '900', marginTop: 14, marginBottom: 2, textTransform: 'uppercase', fontSize: 12.5 }}>{c.name}</Text>
                        {c.items.map(dish)}
                    </View>
                ))}
                {!shown.length ? <Text style={{ color: muted, marginTop: 10 }}>{tr('No dish found')}</Text> : null}
            </Group>

            <Sheet visible={!!sheet} onClose={() => setSheet(null)} title={sheet?.item?.name || ''}>
                {(sheet?.item?.optionGroups || []).map((g) => (
                    <View key={g.id} style={{ marginBottom: 12 }}>
                        <Text style={{ color: text, fontWeight: '900', marginBottom: 6 }}>{g.name}{g.min ? ' *' : ''}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                            {g.options.filter((o) => o.isAvailable !== false).map((o) => {
                                const on = (sheet.picks[g.id] || []).includes(o.id);
                                return (
                                    <Pressable key={o.id} onPress={() => togglePick(g, o)} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
                                        <Text style={{ color: on ? '#fff' : text, fontWeight: '800' }}>{o.name}{o.price ? `  +${rs(o.price)}` : ''}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>
                ))}
                <Button label={tr('Add')} icon="add" onPress={addPicked} />
            </Sheet>
        </FormPage>
    );
}
