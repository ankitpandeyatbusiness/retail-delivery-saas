// Bulk order, step 2: the BULK ORDER cart. The dishes he picked (with pictures and counters), pickup or delivery, the day and time (never sooner than the
// shop's notice from now), the address, the instructions for the kitchen and (for a delivery) for the rider, who he is, and the price. Sending it
// asks the shop for a quote; nothing is paid here.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, TextInput, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, TimeBox, ToggleRow, ChoiceBox, Label } from '../../components/owners/menuBits';
import { FormShimmer } from '../../components/owners/shimmer';
import DateRangeSheet from '../../components/customers/DateRangeSheet';
import { AddressSheet, addrLine } from '../../components/customers/addresses';
import { Chip } from '../../components/customers/cartParts';
import { showToast } from '../../components/customers/shop';
import { rs } from '../../components/customers/orders';
import { fetchBulkConfig, estimateBulk, sendBulk, fetchMyBulk } from '../../api/customers/shopApi';
import { useBulkCartStore } from '../../store/customers/useBulkCartStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { Qty, Thumb } from './BulkOrderScreen';
import { tr } from '../../i18n';

const FOOD_TAGS = ['Less spicy', 'Extra spicy', 'No onion', 'No garlic', 'Less oil', 'Extra crispy', 'Less sugar'];   // the same as the normal cart, until the owner sets his own
const DELIVERY_TAGS = ['Leave at door', 'Avoid calling', "Don't ring bell"];
const pad2 = (n) => String(n).padStart(2, '0');
const localDay = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const dayText = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };
const stamp = (d) => `${d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true })}`;
const digits = (v, n) => String(v || '').replace(/\D/g, '').slice(-n);
const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

export default function BulkCartScreen() {
    const nav = useNavigation();
    const { text, muted, primary, border, surface, error, ok } = useBrand();
    const me = useAuthStore((s) => s.user);
    const lines = useBulkCartStore((s) => s.lines);
    const form = useBulkCartStore((s) => s.form);
    const set = useBulkCartStore.getState().setForm;
    const setContact = useBulkCartStore.getState().setContact;
    const prefs = useHomeStore((s) => s.full?.orders?.dineIn?.prefs) || [];
    const foodTagList = prefs.length ? prefs : FOOD_TAGS;
    const [cfg, setCfg] = useState(null);
    const [err, setErr] = useState('');
    const [last, setLast] = useState(null);                 // his previous bulk order (for "use my last details")
    const [est, setEst] = useState(null);
    const [estBusy, setEstBusy] = useState(false);
    const [sending, setSending] = useState(false);
    const [pickDay, setPickDay] = useState(false);
    const [pickAddr, setPickAddr] = useState(false);
    const [tick, setTick] = useState(0);                    // the earliest time moves on while he fills the form

    useEffect(() => {
        fetchBulkConfig().then((c) => {
            setCfg(c);
            const f = useBulkCartStore.getState().form;
            if (f.fulfilment === 'pickup' && !c.pickup && c.delivery) set({ fulfilment: 'delivery' });
            if (f.fulfilment === 'delivery' && !c.delivery && c.pickup) set({ fulfilment: 'pickup' });
        }).catch((e) => setErr(e?.response?.data?.error || tr('Could not load')));
        fetchMyBulk().then((r) => setLast((r.items || [])[0] || null)).catch(() => { });
        const id = setInterval(() => setTick((x) => x + 1), 60000);
        return () => clearInterval(id);
    }, []);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {   // his name and phone, the first time
        if (!form.contact.name && !form.contact.phone && me) setContact({ name: me.name || '', phone: digits(me.phone, 10) });
    }, [me]);   // eslint-disable-line react-hooks/exhaustive-deps

    const max = cfg?.maxQtyPerDish || 500;
    const delivery = form.fulfilment === 'delivery';

    // the earliest day and time he can choose: now + the shop's notice (set by the owner)
    const earliest = useMemo(() => new Date(Date.now() + (cfg?.noticeHours || 0) * 3600000), [cfg, tick]);   // eslint-disable-line react-hooks/exhaustive-deps
    const minDay = localDay(earliest);
    const earliestTime = useMemo(() => { const d = new Date(earliest.getTime()); const m = Math.ceil(d.getMinutes() / 5) * 5; d.setMinutes(m, 0, 0); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }, [earliest]);
    const chosen = form.day && /^\d{2}:\d{2}$/.test(form.time) ? new Date(`${form.day}T${form.time}:00`) : null;
    const tooEarly = !!chosen && chosen.getTime() < earliest.getTime() - 60000;
    const whenIso = chosen && !Number.isNaN(chosen.getTime()) ? chosen.toISOString() : null;

    const payload = () => ({
        fulfilment: form.fulfilment, when: whenIso, items: lines.map((l) => ({ productId: l.productId, quantity: l.quantity, selections: l.selections })),
        ...(delivery && form.address?._id ? { addressId: String(form.address._id) } : {}),
    });

    // the live price: asked from the server a moment after the last change
    const seq = useRef(0);
    useEffect(() => {
        if (!cfg || !lines.length || !whenIso || tooEarly) { setEst(null); return undefined; }
        const my = ++seq.current;
        setEstBusy(true);
        const t = setTimeout(() => {
            const body = payload();
            if (body.fulfilment === 'delivery' && !body.addressId) body.fulfilment = 'pickup';   // no address yet: the delivery fee is added once he picks one
            estimateBulk(body).then((r) => { if (my === seq.current) setEst(r); }).catch((e) => { if (my === seq.current) { setEst(null); showToast(e?.response?.data?.error || tr('Could not work out the price')); } })
                .finally(() => { if (my === seq.current) setEstBusy(false); });
        }, 500);
        return () => clearTimeout(t);
    }, [lines, form.fulfilment, whenIso, form.address, cfg, tooEarly]);   // eslint-disable-line react-hooks/exhaustive-deps

    const phoneOk = digits(form.contact.phone, 10).length === 10 && String(form.contact.phone).replace(/\D/g, '').length === 10;
    const problems = useMemo(() => {
        const p = [];
        if (!lines.length) p.push(tr('Add at least one dish'));
        if (!form.day) p.push(tr('Choose the date'));
        if (!/^\d{2}:\d{2}$/.test(form.time)) p.push(tr('Choose the time'));
        if (tooEarly) p.push(tr('The earliest time is {t}', { t: stamp(earliest) }));
        if (delivery && !form.address) p.push(tr('Choose the delivery address'));
        if (!form.contact.name.trim()) p.push(tr('Please enter the contact person'));
        if (!phoneOk) p.push(tr('Phone number must be 10 digits'));
        (est?.problems || []).forEach((x) => { if (!(x.code === 'notice' && (!form.day || !form.time))) p.push(x.message); });
        return p;
    }, [lines, form, tooEarly, earliest, delivery, phoneOk, est]);   // eslint-disable-line react-hooks/exhaustive-deps

    const pickDayDone = (d) => {
        set({ day: d || '' });
        setPickDay(false);
        if (d === minDay && !/^\d{2}:\d{2}$/.test(form.time)) set({ day: d, time: earliestTime });   // the earliest day: start the time at the earliest
    };

    const useLast = () => {
        if (!last) return;
        const c = last.contact || {};
        setContact({ name: c.name || form.contact.name, phone: digits(c.phone, 10) || form.contact.phone, onSitePhone: digits(c.onSitePhone, 10), company: c.company || '', gstin: c.gstin || '' });
        set({ cutlery: !!last.cutlery, packaging: last.packaging || 'any', note: last.note || '', ...(last.address?._id && (last.fulfilment === 'delivery') ? { address: last.address } : {}) });
        showToast(tr('Your last details are filled in. Change anything you like.'));
    };

    const send = async () => {
        if (problems.length) return showToast(problems[0]);
        setSending(true);
        try {
            const foodNote = [...form.foodTags, form.foodNote.trim()].filter(Boolean).join(', ').slice(0, 200);
            const deliveryNote = delivery ? [...form.delTags, form.delNote.trim()].filter(Boolean).join(' | ').slice(0, 300) : '';
            const c = form.contact;
            const r = await sendBulk({
                ...payload(), contact: { ...c, phone: digits(c.phone, 10), onSitePhone: digits(c.onSitePhone, 10), gstin: c.gstin.trim().toUpperCase() },
                cutlery: form.cutlery, packaging: form.packaging, note: form.note.trim(), ...(foodNote ? { foodNote } : {}), ...(deliveryNote ? { deliveryNote } : {}),
            });
            useBulkCartStore.getState().clear();
            showToast(tr('Request sent. The shop will send you a quote.'));
            nav.replace('BulkOrderDetail', { id: r.id });
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Try again.')); } finally { setSending(false); }
    };

    if (!cfg) return <FormPage title={tr('BULK ORDER')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    if (!lines.length) {
        return (
            <FormPage title={tr('BULK ORDER')}>
                <Empty icon="cube-outline" title={tr('Your bulk cart is empty')} hint={tr('Pick the dishes you want for your function or office.')} />
                <View style={{ paddingHorizontal: 16 }}><Button label={tr('Pick dishes')} icon="restaurant-outline" onPress={() => nav.replace('BulkOrder')} /></View>
            </FormPage>
        );
    }

    const total = est?.pricing?.total;
    const footer = (
        <View>
            {problems.length ? <Text style={{ color: error, fontWeight: '700', fontSize: 12.5, marginBottom: 6 }}>{problems[0]}</Text> : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ color: muted, flex: 1 }}>{tr('Estimate, the shop confirms the final price')}</Text>
                <Text style={{ color: text, fontWeight: '900', fontSize: 20 }}>{total !== undefined ? rs(total) : estBusy ? '…' : '—'}</Text>
            </View>
            <Button label={tr('Ask the shop for a quote')} icon="send" busy={sending} disabled={estBusy} onPress={send} />
        </View>
    );

    const input = { color: text, borderColor: border, backgroundColor: surface, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, marginTop: 6 };
    return (
        <FormPage title={tr('BULK ORDER')} footer={footer}>
            <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginHorizontal: 16, marginBottom: 6, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 99, backgroundColor: primary + '1F' }}>
                <Ionicons name="cube" size={14} color={primary} style={{ marginRight: 6 }} />
                <Text style={{ color: primary, fontWeight: '900', fontSize: 12.5 }}>{tr('This is a bulk order: the shop sends a quote first. You pay after you accept it.')}</Text>
            </View>

            <Group title={delivery ? tr('Delivery') : tr('Pickup')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {cfg.pickup ? <Chip label={tr('Pickup')} icon="bag-handle-outline" on={!delivery} onPress={() => set({ fulfilment: 'pickup' })} /> : null}
                    {cfg.delivery ? <Chip label={tr('Delivery')} icon="bicycle-outline" on={delivery} onPress={() => set({ fulfilment: 'delivery' })} /> : null}
                </View>
                <View style={{ height: 10 }} />
                <Label required hint={tr('Earliest: {t}', { t: stamp(earliest) }) + (cfg.noticeHours ? ` · ${tr('The shop needs {n} hours notice', { n: cfg.noticeHours })}` : '')}>{delivery ? tr('Delivery date and time') : tr('Pickup date and time')}</Label>
                <Pressable onPress={() => setPickDay(true)} style={{ minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <Text style={{ flex: 1, color: form.day ? text : muted, fontSize: 15, fontWeight: '600' }}>{form.day ? dayText(form.day) : tr('Tap to pick a day')}</Text>
                    <Ionicons name="calendar-outline" size={18} color={muted} />
                </Pressable>
                <TimeBox label={tr('Time')} required value={form.time} onChange={(v) => set({ time: v })} placeholder="13:00" last={!delivery} error={tooEarly ? tr('The earliest time is {t}', { t: stamp(earliest) }) : undefined} />
                {delivery ? (
                    <>
                        <Label required>{tr('Delivery address')}</Label>
                        <Pressable onPress={() => setPickAddr(true)} style={{ minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' }}>
                            <Ionicons name="location-outline" size={18} color={primary} style={{ marginRight: 8 }} />
                            <Text numberOfLines={2} style={{ flex: 1, color: form.address ? text : muted, fontWeight: '600' }}>{form.address ? addrLine(form.address) : tr('Choose the delivery address')}</Text>
                        </Pressable>
                    </>
                ) : null}
            </Group>

            <Group title={tr('Your dishes')} hint={cfg.minOrderAmount ? tr('The minimum bulk order is {a}. Hold + to add 10 at a time, or type the number.', { a: rs(cfg.minOrderAmount) }) : undefined}>
                {lines.map((l, i) => {
                    const p = est?.lines?.[i];
                    return (
                        <View key={l.key} style={{ paddingVertical: 10, borderBottomWidth: i === lines.length - 1 ? 0 : 1, borderBottomColor: border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Thumb uri={l.image} size={52} />
                                <View style={{ flex: 1, marginLeft: 12 }}>
                                    <Text numberOfLines={2} style={{ color: text, fontWeight: '800', fontSize: 15 }}>{l.name}</Text>
                                    {l.label ? <Text style={{ color: muted, fontSize: 12.5 }}>{l.label}</Text> : null}
                                    {p ? <Text style={{ color: p.bulkApplied ? ok : muted, fontSize: 12, marginTop: 1 }}>{p.quantity} × {rs(p.unitPrice)}{p.bulkApplied ? `  (${tr('bulk price, was')} ${rs(p.listPrice)})` : ''} = {rs(p.lineTotal)}</Text> : null}
                                </View>
                            </View>
                            <View style={{ alignItems: 'flex-end', marginTop: 8 }}>
                                <Qty value={l.quantity} max={max} min={l.minQty || 0} onChange={(n) => useBulkCartStore.getState().setQty({ id: l.productId, name: l.name, image: l.image, isVeg: l.isVeg }, l.selections, l.label, n, l.minQty || 0)} />
                            </View>
                        </View>
                    );
                })}
                <Pressable onPress={() => nav.navigate('BulkOrder')} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                    <Ionicons name="add-circle-outline" size={18} color={primary} style={{ marginRight: 6 }} />
                    <Text style={{ color: primary, fontWeight: '800' }}>{tr('Add more dishes')}</Text>
                </Pressable>
            </Group>

            <Group title={tr('Instructions for the kitchen')}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {foodTagList.map((n) => <Chip key={n} label={tr(n)} on={form.foodTags.includes(n)} onPress={() => set({ foodTags: toggle(form.foodTags, n) })} />)}
                </View>
                <TextInput value={form.foodNote} onChangeText={(v) => set({ foodNote: v })} maxLength={200} placeholder={tr('E.g., less spicy, no onion, extra crispy...')} placeholderTextColor={muted} style={input} />
                <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The cook hears this before your food is made.')}</Text>
            </Group>

            {delivery ? (
                <Group title={tr('Delivery Instructions')}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                        {DELIVERY_TAGS.map((n) => <Chip key={n} label={tr(n)} on={form.delTags.includes(n)} onPress={() => set({ delTags: toggle(form.delTags, n) })} />)}
                    </ScrollView>
                    <TextInput value={form.delNote} onChangeText={(v) => set({ delNote: v })} maxLength={200} placeholder={tr('E.g., Any specific landmark or instructions...')} placeholderTextColor={muted} style={input} />
                </Group>
            ) : null}

            {est?.lines?.length ? (
                <Group title={tr('Price')}>
                    <Row2 k={tr('Items')} v={rs(est.pricing.subtotal)} />
                    {est.pricing.taxOnTop > 0 ? <Row2 k={tr('GST')} v={rs(est.pricing.taxOnTop)} /> : null}
                    {est.pricing.packagingCharge > 0 ? <Row2 k={tr('Packaging')} v={rs(est.pricing.packagingCharge)} /> : null}
                    {delivery ? <Row2 k={tr('Delivery')} v={form.address ? rs(est.pricing.deliveryFee) : tr('after you pick the address')} /> : null}
                    <Row2 k={tr('Estimated total')} v={rs(est.pricing.total)} bold />
                    {est.bulkSaved > 0 ? <Text style={{ color: ok, fontWeight: '800', marginTop: 6 }}>{tr('You save {a} with bulk prices', { a: rs(est.bulkSaved) })}</Text> : null}
                    <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The shop will send its own quote. You pay only after you accept it.')}</Text>
                </Group>
            ) : null}

            <Group title={tr('A few things the shop needs')}>
                {last ? (
                    <Pressable onPress={useLast} style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: primary, marginBottom: 14 }}>
                        <Ionicons name="refresh-circle-outline" size={18} color={primary} style={{ marginRight: 6 }} />
                        <Text style={{ color: primary, fontWeight: '800' }}>{tr('Use my last details')}</Text>
                    </Pressable>
                ) : null}
                <ToggleRow title={tr('Send cutlery')} subtitle={tr('Plates, spoons and so on')} value={form.cutlery} onValueChange={(v) => set({ cutlery: v })} />
                <ChoiceBox label={tr('Packing')} options={[['boxes', tr('Individual boxes')], ['trays', tr('Big trays')], ['any', tr('Any')]]} value={form.packaging} onChange={(v) => set({ packaging: v })} />
                <TextBox label={tr('Contact person')} required value={form.contact.name} onChangeText={(v) => setContact({ name: v })} maxLength={80} />
                <TextBox label={tr('Phone number')} required value={form.contact.phone} onChangeText={(v) => setContact({ phone: digits(v, 10) })} keyboardType="number-pad" maxLength={10} placeholder="10 digits" />
                <TextBox label={tr('Phone of the person at the place (optional)')} value={form.contact.onSitePhone} onChangeText={(v) => setContact({ onSitePhone: digits(v, 10) })} keyboardType="number-pad" maxLength={10} />
                <TextBox label={tr('Company name (optional)')} value={form.contact.company} onChangeText={(v) => setContact({ company: v })} maxLength={100} />
                <TextBox label={tr('GST number for the invoice (optional)')} value={form.contact.gstin} onChangeText={(v) => setContact({ gstin: v })} autoCapitalize="characters" maxLength={15} />
                <TextBox label={tr('Anything else')} value={form.note} onChangeText={(v) => set({ note: v })} multiline maxLength={500} placeholder={tr('Spice level, timing, who receives it...')} last />
            </Group>

            <DateRangeSheet single ahead={180} minDay={minDay} visible={pickDay} value={form.day} title={tr('Pick a day')} onClose={() => setPickDay(false)} onApply={pickDayDone} />
            <AddressSheet visible={pickAddr} onClose={() => setPickAddr(false)} onSelect={(a) => { set({ address: a }); setPickAddr(false); }} />
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
