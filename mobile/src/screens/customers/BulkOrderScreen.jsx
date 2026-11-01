// Bulk order: the whole menu with a counter on every dish (and on every option the owner made: Half, Full...). The price is worked out by the
// server while the customer picks, with the shop's bulk prices. Then pickup or delivery, the time, and the few questions a shop needs. Sending it
// asks the shop for a quote; nothing is paid here.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty, Sheet, Chips } from '../../components/owners/ui';
import { FormPage, Group, TextBox, TimeBox, ToggleRow, ChoiceBox, VegMark, Label } from '../../components/owners/menuBits';
import { FormShimmer } from '../../components/owners/shimmer';
import DateRangeSheet from '../../components/customers/DateRangeSheet';
import { AddressSheet, addrLine } from '../../components/customers/addresses';
import { showToast } from '../../components/customers/shop';
import { rs } from '../../components/customers/orders';
import { fetchBulkConfig, fetchBulkMenu, estimateBulk, sendBulk } from '../../api/customers/shopApi';
import { useAuthStore } from '../../store/common/useAuthStore';
import { tr } from '../../i18n';

const dayText = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const keyOf = (productId, selections) => `${productId}|${JSON.stringify((selections || []).map((s) => [s.groupId, [...s.optionIds].sort()]).sort())}`;
const clean = (x, max) => Math.max(0, Math.min(max, Math.floor(Number(x) || 0)));

// one counter: minus, a number he can also type, plus (hold plus to add 10)
function Qty({ value, max, onChange }) {
    const { text, border, primary, onPrimary, surface } = useBrand();
    const btn = { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' };
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Pressable disabled={!value} onPress={() => onChange(clean(value - 1, max))} style={[btn, { borderWidth: 1, borderColor: border, backgroundColor: surface, opacity: value ? 1 : 0.4 }]}>
                <Ionicons name="remove" size={18} color={text} />
            </Pressable>
            <TextInput
                value={value ? String(value) : ''} placeholder="0" placeholderTextColor={border} keyboardType="number-pad" maxLength={5}
                onChangeText={(t) => onChange(clean(t.replace(/\D/g, ''), max))}
                style={{ minWidth: 52, textAlign: 'center', color: text, fontWeight: '900', fontSize: 16, paddingVertical: 4 }}
            />
            <Pressable onPress={() => onChange(clean(value + 1, max))} onLongPress={() => onChange(clean(value + 10, max))} style={[btn, { backgroundColor: primary }]}>
                <Ionicons name="add" size={18} color={onPrimary} />
            </Pressable>
        </View>
    );
}

export default function BulkOrderScreen() {
    const nav = useNavigation();
    const { text, muted, primary, border, surface, error, ok } = useBrand();
    const me = useAuthStore((s) => s.user);
    const [cfg, setCfg] = useState(null);
    const [menu, setMenu] = useState(null);
    const [err, setErr] = useState('');
    const [find, setFind] = useState('');
    const [lines, setLines] = useState([]);                 // { key, productId, selections, label, quantity }
    const [fulfilment, setFulfilment] = useState('pickup');
    const [day, setDay] = useState('');
    const [time, setTime] = useState('');
    const [address, setAddress] = useState(null);
    const [pickDay, setPickDay] = useState(false);
    const [pickAddr, setPickAddr] = useState(false);
    const [cutlery, setCutlery] = useState(false);
    const [packaging, setPackaging] = useState('any');
    const [contact, setContact] = useState({ name: me?.name || '', phone: me?.phone || '', onSitePhone: '', company: '', gstin: '' });
    const [note, setNote] = useState('');
    const [est, setEst] = useState(null);
    const [estBusy, setEstBusy] = useState(false);
    const [sending, setSending] = useState(false);
    const [sheet, setSheet] = useState(null);               // { item, picks } for a dish whose choices need more than one tap

    useEffect(() => {
        Promise.all([fetchBulkConfig(), fetchBulkMenu()]).then(([c, m]) => {
            setCfg(c); setMenu(m.categories || []);
            if (!c.pickup && c.delivery) setFulfilment('delivery');
        }).catch((e) => setErr(e?.response?.data?.error || tr('Could not load the menu')));
    }, []);

    const max = cfg?.maxQtyPerDish || 500;
    const itemById = useMemo(() => new Map((menu || []).flatMap((c) => c.items).map((i) => [i.id, i])), [menu]);
    const qtyOf = (productId, selections) => lines.find((l) => l.key === keyOf(productId, selections))?.quantity || 0;
    const setQty = (item, selections, label, n) => setLines((all) => {
        const key = keyOf(item.id, selections);
        const rest = all.filter((l) => l.key !== key);
        return n > 0 ? [...rest, { key, productId: item.id, selections, label, quantity: n, at: all.find((l) => l.key === key)?.at || Date.now() }].sort((a, b) => a.at - b.at) : rest;
    });
    const piecesOf = (productId) => lines.filter((l) => l.productId === productId).reduce((n, l) => n + l.quantity, 0);

    const whenIso = useMemo(() => {
        const t = /^\d{2}:\d{2}$/.test(time) ? time : '12:00';
        const base = day || new Date(Date.now() + ((cfg?.noticeHours || 0) + 24) * 3600000).toISOString().slice(0, 10);
        const d = new Date(`${base}T${t}:00`);
        return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }, [day, time, cfg]);
    const payload = () => ({
        fulfilment, when: whenIso, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, selections: l.selections })),
        ...(fulfilment === 'delivery' && address ? { addressId: String(address._id) } : {}),
    });

    // the live price: asked from the server a moment after the last change
    const seq = useRef(0);
    useEffect(() => {
        if (!cfg || !lines.length || !whenIso) { setEst(null); return undefined; }
        const my = ++seq.current;
        setEstBusy(true);
        const t = setTimeout(() => {
            const body = payload();
            if (body.fulfilment === 'delivery' && !body.addressId) body.fulfilment = 'pickup';   // no address yet: the delivery fee is added once he picks one
            estimateBulk(body).then((r) => { if (my === seq.current) setEst(r); }).catch((e) => { if (my === seq.current) { setEst(null); showToast(e?.response?.data?.error || tr('Could not work out the price')); } })
                .finally(() => { if (my === seq.current) setEstBusy(false); });
        }, 500);
        return () => clearTimeout(t);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lines, fulfilment, whenIso, address, cfg]);

    const problems = useMemo(() => {
        const p = [];
        if (!day) p.push(tr('Choose the date'));
        if (!/^\d{2}:\d{2}$/.test(time)) p.push(tr('Choose the time'));
        if (fulfilment === 'delivery' && !address) p.push(tr('Choose the delivery address'));
        if (!lines.length) p.push(tr('Add at least one dish'));
        (est?.problems || []).forEach((x) => { if (!(x.code === 'notice' && (!day || !time))) p.push(x.message); });
        return p;
    }, [day, time, fulfilment, address, lines, est]);

    const send = async () => {
        if (problems.length) return showToast(problems[0]);
        if (!contact.name.trim()) return showToast(tr('Please enter the contact person'));
        if (contact.phone.replace(/\D/g, '').length < 6) return showToast(tr('Please enter a phone number'));
        setSending(true);
        try {
            const r = await sendBulk({ ...payload(), contact: { ...contact, gstin: contact.gstin.trim().toUpperCase() }, cutlery, packaging, note: note.trim() });
            showToast(tr('Request sent. The shop will send you a quote.'));
            nav.replace('BulkOrderDetail', { id: r.id });
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Try again.')); } finally { setSending(false); }
    };

    if (!cfg || !menu) {
        return <FormPage title={tr('Bulk order')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    }
    if (!cfg.enabled) return <FormPage title={tr('Bulk order')}><Empty icon="cube-outline" title={tr('Not available')} hint={tr('This shop does not take bulk orders right now.')} /></FormPage>;

    const set = (k) => (x) => setContact((c) => ({ ...c, [k]: x }));
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
                    <VegMark isVeg={i.isVeg} />
                    <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15, marginLeft: 8 }}>{i.name}</Text>
                    {!i.optionGroups.length ? <Text style={{ color: muted, fontWeight: '700', marginRight: 10 }}>{rs(i.price)}</Text> : null}
                </View>
                {bulkNote ? <Text style={{ color: got ? ok : primary, fontSize: 12, fontWeight: '800', marginTop: 3 }}>{got ? `✓ ${bulkNote}` : bulkNote}</Text> : null}
                {!i.optionGroups.length ? (
                    <View style={{ alignItems: 'flex-end', marginTop: 8 }}><Qty value={qtyOf(i.id, [])} max={max} onChange={(n) => setQty(i, [], '', n)} /></View>
                ) : oneChoice(i) ? i.optionGroups[0].options.filter((o) => o.isAvailable !== false).map((o) => {
                    const sel = [{ groupId: i.optionGroups[0].id, optionIds: [o.id] }];
                    return (
                        <View key={o.id} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                            <Text style={{ flex: 1, color: text, fontSize: 14 }}>{o.name}  <Text style={{ color: muted }}>{price(i, o)}</Text></Text>
                            <Qty value={qtyOf(i.id, sel)} max={max} onChange={(n) => setQty(i, sel, o.name, n)} />
                        </View>
                    );
                }) : (
                    <>
                        {lines.filter((l) => l.productId === i.id).map((l) => (
                            <View key={l.key} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                <Text style={{ flex: 1, color: text, fontSize: 13 }}>{l.label}</Text>
                                <Qty value={l.quantity} max={max} onChange={(n) => setQty(i, l.selections, l.label, n)} />
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

    const total = est?.pricing?.total;
    const footer = (
        <View>
            {problems.length && lines.length ? <Text style={{ color: error, fontWeight: '700', fontSize: 12.5, marginBottom: 6 }}>{problems[0]}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: muted, flex: 1 }}>{tr('Estimate, the shop confirms the final price')}</Text>
                <Text style={{ color: text, fontWeight: '900', fontSize: 20 }}>{total !== undefined ? rs(total) : estBusy ? '…' : '—'}</Text>
            </View>
            <Button label={tr('Ask the shop for a quote')} icon="send" busy={sending} disabled={!lines.length || estBusy} onPress={send} />
        </View>
    );

    return (
        <FormPage title={tr('Bulk order')} footer={footer}>
            <Group title={tr('How do you want it?')}>
                <Chips value={fulfilment} onChange={setFulfilment} options={[cfg.pickup ? ['pickup', tr('Pickup')] : null, cfg.delivery ? ['delivery', tr('Delivery')] : null].filter(Boolean)} />
                <View style={{ height: 12 }} />
                <Label hint={cfg.noticeHours ? tr('The shop needs {n} hours notice', { n: cfg.noticeHours }) : undefined}>{fulfilment === 'delivery' ? tr('Delivery date and time') : tr('Pickup date and time')}</Label>
                <Pressable onPress={() => setPickDay(true)} style={{ minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={{ flex: 1, color: day ? text : muted, fontSize: 15, fontWeight: '600' }}>{day ? dayText(day) : tr('Tap to pick a day')}</Text>
                    <Ionicons name="calendar-outline" size={18} color={muted} />
                </Pressable>
                <TimeBox label={tr('Time')} value={time} onChange={setTime} placeholder="13:00" last={fulfilment !== 'delivery'} />
                {fulfilment === 'delivery' ? (
                    <Pressable onPress={() => setPickAddr(true)} style={{ minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="location-outline" size={18} color={primary} style={{ marginRight: 8 }} />
                        <Text numberOfLines={2} style={{ flex: 1, color: address ? text : muted, fontWeight: '600' }}>{address ? addrLine(address) : tr('Choose the delivery address')}</Text>
                    </Pressable>
                ) : null}
            </Group>

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

            {est?.lines?.length ? (
                <Group title={tr('Your order')}>
                    {est.lines.map((l, i) => (
                        <View key={`${l.productId}${i}`} style={{ flexDirection: 'row', paddingVertical: 6 }}>
                            <View style={{ flex: 1, paddingRight: 8 }}>
                                <Text style={{ color: text, fontWeight: '700' }}>{l.name}{lines[i]?.label ? ` · ${lines[i].label}` : ''}</Text>
                                <Text style={{ color: l.bulkApplied ? ok : muted, fontSize: 12 }}>{l.quantity} × {rs(l.unitPrice)}{l.bulkApplied ? `  (${tr('bulk price, was')} ${rs(l.listPrice)})` : ''}</Text>
                            </View>
                            <Text style={{ color: text, fontWeight: '800' }}>{rs(l.lineTotal)}</Text>
                        </View>
                    ))}
                    <View style={{ height: 1, backgroundColor: border, marginVertical: 8 }} />
                    <Row2 k={tr('Items')} v={rs(est.pricing.subtotal)} />
                    {est.pricing.taxOnTop > 0 ? <Row2 k={tr('GST')} v={rs(est.pricing.taxOnTop)} /> : null}
                    {est.pricing.packagingCharge > 0 ? <Row2 k={tr('Packaging')} v={rs(est.pricing.packagingCharge)} /> : null}
                    {fulfilment === 'delivery' ? <Row2 k={tr('Delivery')} v={address ? rs(est.pricing.deliveryFee) : tr('after you pick the address')} /> : null}
                    <Row2 k={tr('Estimated total')} v={rs(est.pricing.total)} bold />
                    {est.bulkSaved > 0 ? <Text style={{ color: ok, fontWeight: '800', marginTop: 6 }}>{tr('You save {a} with bulk prices', { a: rs(est.bulkSaved) })}</Text> : null}
                    <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The shop will send its own quote. You pay only after you accept it.')}</Text>
                </Group>
            ) : null}

            <Group title={tr('A few things the shop needs')}>
                <ToggleRow title={tr('Send cutlery')} subtitle={tr('Plates, spoons and so on')} value={cutlery} onValueChange={setCutlery} />
                <ChoiceBox label={tr('Packing')} options={[['boxes', tr('Individual boxes')], ['trays', tr('Big trays')], ['any', tr('Any')]]} value={packaging} onChange={setPackaging} />
                <TextBox label={tr('Contact person')} value={contact.name} onChangeText={set('name')} maxLength={80} />
                <TextBox label={tr('Phone number')} value={contact.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={20} />
                <TextBox label={tr('Phone of the person at the place (optional)')} value={contact.onSitePhone} onChangeText={set('onSitePhone')} keyboardType="phone-pad" maxLength={20} />
                <TextBox label={tr('Company name (optional)')} value={contact.company} onChangeText={set('company')} maxLength={100} />
                <TextBox label={tr('GST number for the invoice (optional)')} value={contact.gstin} onChangeText={set('gstin')} autoCapitalize="characters" maxLength={15} />
                <TextBox label={tr('Anything else')} value={note} onChangeText={setNote} multiline maxLength={500} placeholder={tr('Spice level, timing, who receives it...')} last />
            </Group>

            <DateRangeSheet single ahead={180} visible={pickDay} value={day} title={tr('Pick a day')} onClose={() => setPickDay(false)} onApply={(d) => { setDay(d || ''); setPickDay(false); }} />
            <AddressSheet visible={pickAddr} onClose={() => setPickAddr(false)} onSelect={(a) => { setAddress(a); setPickAddr(false); }} />

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

function Row2({ k, v, bold }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 2 }}>
            <Text style={{ flex: 1, color: bold ? text : muted, fontWeight: bold ? '900' : '600' }}>{k}</Text>
            <Text style={{ color: text, fontWeight: bold ? '900' : '700' }}>{v}</Text>
        </View>
    );
}
