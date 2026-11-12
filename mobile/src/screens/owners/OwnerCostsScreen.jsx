// Costs and profit: what the shop spends (ingredients, salaries, shop rent...), and what it really kept after them, the rent and the SMS paid to the platform.
// A cost that repeats every month (a salary, the shop rent) counts a share for each day, so any period gives a fair profit.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, SectionTitle, Row, Sheet, Field, Empty, money } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import SlideSwitch from '../../components/common/SlideSwitch';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { StatShimmer } from '../../components/owners/shimmer';
import { fetchCosts, addCost, updateCost, deleteCost, fetchProfit, apiError } from '../../api/owners/shopApi';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { alpha } from '../../components/common/kit';
import { Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import Masonry from '../../components/common/Masonry';
import { tr } from '../../i18n';

const CAT_ICON = { ingredients: 'nutrition', salaries: 'people', shop_rent: 'storefront', electricity_gas: 'flash', packaging: 'cube', marketing: 'megaphone', repairs: 'construct', transport: 'car', other: 'ellipsis-horizontal-circle' };
import { useOwnerDesktop } from '../../utils/common/layout';

const IST = 330 * 60000;
const ymd = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const rangeOf = (w) => {
    const now = Date.now();
    if (w === '7' || w === '30') return { from: ymd(now - (Number(w) - 1) * 86400000), to: ymd(now) };
    if (w === 'lastmonth') { const d = new Date(now + IST); d.setUTCDate(1); d.setUTCDate(0); const last = d.toISOString().slice(0, 10); return { from: `${last.slice(0, 8)}01`, to: last }; }
    return { from: `${ymd(now).slice(0, 8)}01`, to: ymd(now) };
};
const LABEL = {
    ingredients: 'Ingredients and stock', salaries: 'Salaries', shop_rent: 'Shop rent', electricity_gas: 'Electricity, gas and water', packaging: 'Packaging',
    marketing: 'Marketing', repairs: 'Repairs', transport: 'Transport', other: 'Other',
};
const blank = () => ({ id: null, category: 'ingredients', amount: '', date: ymd(Date.now()), otherName: '', vendor: '', note: '', repeatMonthly: false });

export default function OwnerCostsScreen() {
    const desk = useOwnerDesktop();   // a computer keeps what is on screen while the new list loads
    const { background, text, muted, primary, errorText, ok } = useBrand();   // ok and errorText stay readable on a dark canvas (there is no "success" colour: it was undefined, so the profit drew in default black)
    const [which, setWhich] = useState('month');
    const [p, setP] = useState(null);
    const [list, setList] = useState(null);
    const [err, setErr] = useState('');
    const [form, setForm] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        const r = rangeOf(which);
        try {
            const [pr, ls] = await Promise.all([fetchProfit(r), fetchCosts(r)]);
            setP(pr); setList(ls); setErr('');
        } catch (e) { setErr(apiError(e, 'Could not load.')); }
    }, [which]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => { if (!desk) { setP(null); setList(null); } }, [which]);

    const save = async () => {
        const paise = Math.round(Number(String(form.amount).replace(/,/g, '')) * 100);
        if (!(paise > 0)) { showToast(tr('Enter the amount')); return; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(form.date)) { showToast(tr('The date must look like 2026-11-05')); return; }
        if (form.category === 'other' && !form.otherName.trim()) { showToast(tr('Write what this cost is')); return; }
        const body = { date: form.date, category: form.category, amountPaise: paise, otherName: form.category === 'other' ? form.otherName.trim() : '', vendor: form.vendor.trim(), note: form.note.trim(), repeatMonthly: form.repeatMonthly };
        setBusy(true);
        try { if (form.id) await updateCost(form.id, body); else await addCost(body); setForm(null); showToast(tr('Saved')); load(); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    const remove = async () => {
        if (!(await ask({ title: tr('Delete this cost?'), message: tr('It will no longer count in your profit.'), confirmText: tr('Delete'), cancelText: tr('Keep it'), destructive: true }))) return;
        try { await deleteCost(form.id); setForm(null); showToast(tr('Deleted')); load(); } catch (e) { showToast(apiError(e)); }
    };
    const edit = (c) => setForm({ id: c.id, category: c.category, amount: String(c.amountPaise / 100), date: String(c.date).slice(0, 10), otherName: c.otherName, vendor: c.vendor, note: c.note, repeatMonthly: c.repeatMonthly });

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Costs and profit')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
              <View style={desk ? { width: '100%', maxWidth: 1240, alignSelf: 'center' } : undefined}>
                {desk ? (
                    <Hero icon="calculator" title={tr('Costs and profit')} subtitle={tr('Write down what you spend, and the profit becomes real.')}
                        right={<>
                            {[['month', tr('This month')], ['lastmonth', tr('Last month')], ['7', tr('7 days')], ['30', tr('30 days')]].map(([k, label]) => (
                                <Pressable key={k} onPress={() => setWhich(k)} style={({ hovered }) => ({ paddingHorizontal: 14, height: 38, borderRadius: 19, marginLeft: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: which === k ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)', cursor: 'pointer' })}>
                                    <Text style={{ color: which === k ? primary : '#FFFFFF', fontWeight: '800', fontSize: 13 }}>{label}</Text>
                                </Pressable>
                            ))}
                            <HeroBtn label={tr('Add a cost')} icon="add-circle" solid onPress={() => setForm(blank())} />
                        </>}>
                        {p ? (
                            <View style={{ flexDirection: 'row', marginTop: 18 }}>
                                <GlassStat label={p.profit >= 0 ? tr('Profit') : tr('Loss')} value={money(p.profit)} icon={p.profit >= 0 ? 'trending-up-outline' : 'trending-down-outline'} />
                                <GlassStat label={tr('Sales')} value={money(p.sales.revenue)} icon="cash-outline" />
                                <GlassStat label={tr('Costs')} value={money(p.costs.total)} icon="receipt-outline" />
                                <GlassStat label={tr('Margin')} value={p.marginPct !== null ? `${p.marginPct}%` : '—'} icon="pie-chart-outline" />
                            </View>
                        ) : null}
                    </Hero>
                ) : null}
                {desk ? null : <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['month', tr('This month')], ['lastmonth', tr('Last month')], ['7', tr('7 days')], ['30', tr('30 days')]]} value={which} onChange={setWhich} style={{ marginTop: 0 }} />
                </View>}
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {!p && !err ? <StatShimmer /> : null}
                <Masonry desk={desk} gap={-16}>
                {p ? (
                    <>
                        {desk ? null : <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{p.from === p.to ? p.from : `${p.from} - ${p.to}`}</Text>
                            <Text style={{ color: p.profit >= 0 ? ok : errorText, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(p.profit)}</Text>
                            <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{p.profit >= 0 ? tr('Profit') : tr('Loss')}{p.marginPct !== null ? ` · ${p.marginPct}%` : ''}</Text>
                            {p.before && (p.before.revenue || p.before.costs) ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('The period before: {amount}', { amount: money(p.before.profit) })}</Text> : null}
                        </Card>}

                        <SectionTitle title={tr('Where the money went')} />
                        <Card>
                            <MoneyRow title={tr('Sales')} note={tr('{n} orders delivered', { n: p.sales.orders })} value={money(p.sales.revenue)} />
                            {p.costs.items.map((i) => <MoneyRow key={i.key} title={tr(i.label)} value={`- ${money(i.amount)}`} />)}
                            {p.costs.rentPaid ? <MoneyRow title={tr('Rent paid to the platform')} value={`- ${money(p.costs.rentPaid)}`} /> : null}
                            {p.costs.smsPaid ? <MoneyRow title={tr('SMS top-ups')} value={`- ${money(p.costs.smsPaid)}`} /> : null}
                            <MoneyRow title={tr('Profit')} value={money(p.profit)} color={p.profit >= 0 ? ok : errorText} last />
                        </Card>
                    </>
                ) : null}

                {desk ? null : <View style={{ paddingHorizontal: 16, marginTop: 12 }}><Button label={tr('Add a cost')} icon="add" onPress={() => setForm(blank())} /></View>}

                {list ? (
                    <>
                        <SectionTitle title={tr('Costs you wrote down')} />
                        {list.items.length ? (
                            <Card style={{ paddingHorizontal: 12 }}>
                                {list.items.map((c, i) => (
                                    <Row key={c.id} icon={c.repeatMonthly ? 'repeat' : 'receipt-outline'} title={c.category === 'other' && c.otherName ? c.otherName : tr(LABEL[c.category] || c.category)} subtitle={`${String(c.date).slice(0, 10)}${c.vendor ? ` · ${c.vendor}` : ''}${c.repeatMonthly ? ` · ${tr('every month')}` : ''}`} right={<Text style={{ color: text, fontWeight: '800' }}>{money(c.amountPaise / 100)}</Text>} onPress={() => edit(c)} last={i === list.items.length - 1} />
                                ))}
                            </Card>
                        ) : <Empty icon="receipt-outline" title={tr('No costs yet')} hint={tr('Add what you spend, and the profit becomes real.')} />}
                    </>
                ) : null}
                </Masonry>
              </View>
            </ScrollView>

            <Sheet visible={!!form} onClose={() => setForm(null)} title={form && form.id ? tr('Change a cost') : tr('Add a cost')}>
                {form && desk ? (
                    <View>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 14, marginBottom: 10 }}>{tr('What is it for?')}</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
                            {Object.entries(LABEL).map(([k, l]) => {
                                const on = form.category === k;
                                return (
                                    <View key={k} style={{ width: '33.333%', padding: 5 }}>
                                        <Pressable onPress={() => setForm({ ...form, category: k })} style={({ hovered }) => ({ alignItems: 'center', paddingVertical: 14, paddingHorizontal: 6, borderRadius: 18, borderWidth: 1.5, borderColor: on ? primary : hovered ? alpha(primary, 0.55) : alpha(muted, 0.3), backgroundColor: on ? alpha(primary, 0.12) : hovered ? alpha(primary, 0.05) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '140ms' })}>
                                            <Ionicons name={CAT_ICON[k] || 'cash'} size={22} color={on ? primary : muted} />
                                            <Text style={{ color: on ? primary : text, fontWeight: '800', fontSize: 12.5, marginTop: 6, textAlign: 'center' }} numberOfLines={2}>{tr(l)}</Text>
                                        </Pressable>
                                    </View>
                                );
                            })}
                        </View>
                        {form.category === 'other' ? <Field value={form.otherName} onChangeText={(v) => setForm({ ...form, otherName: v })} placeholder={tr('What is it? e.g. pest control')} style={{ marginTop: 8 }} /> : null}
                        <View style={{ flexDirection: 'row', marginTop: 16 }}>
                            <View style={{ flex: 1.2, marginRight: 12 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 13, marginBottom: 6 }}>{tr('Amount (₹)')}</Text>
                                <Field value={form.amount} onChangeText={(v) => setForm({ ...form, amount: v })} placeholder="1500" keyboardType="numeric" maxLength={9} style={{ fontSize: 22, fontWeight: '900', minHeight: 56 }} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 13, marginBottom: 6 }}>{tr('Date')}</Text>
                                <Field value={form.date} onChangeText={(v) => setForm({ ...form, date: v })} placeholder="2026-11-05" maxLength={10} keyboardType="numbers-and-punctuation" style={{ minHeight: 56 }} />
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', marginTop: 14 }}>
                            <View style={{ flex: 1, marginRight: 12 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 13, marginBottom: 6 }}>{tr('Paid to (optional)')}</Text>
                                <Field value={form.vendor} onChangeText={(v) => setForm({ ...form, vendor: v })} placeholder={tr('e.g. the vegetable market')} maxLength={80} />
                            </View>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 13, marginBottom: 6 }}>{tr('Note (optional)')}</Text>
                                <Field value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} maxLength={200} />
                            </View>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, padding: 14, borderRadius: 18, backgroundColor: alpha(muted, 0.1) }}>
                            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}><Ionicons name="repeat" size={20} color={primary} /></View>
                            <View style={{ flex: 1, paddingRight: 10 }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{tr('Repeats every month')}</Text>
                                <Text style={{ color: muted, fontSize: 12 }}>{tr('For a salary or the shop rent. It counts a share for each day.')}</Text>
                            </View>
                            <SlideSwitch value={form.repeatMonthly} onValueChange={(v) => setForm({ ...form, repeatMonthly: v })} />
                        </View>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            {form.id ? <Button label={tr('Delete')} kind="ghost" icon="trash-outline" onPress={remove} style={{ flex: 1, marginRight: 10 }} /> : null}
                            <Button label={tr('Save')} icon="checkmark" onPress={save} busy={busy} style={{ flex: 2 }} />
                        </View>
                    </View>
                ) : null}
                {form && !desk ? (
                    <ScrollView style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '800' }}>{tr('What is it for?')}</Text>
                        <Chips options={Object.entries(LABEL).map(([k, l]) => [k, tr(l)])} value={form.category} onChange={(v) => setForm({ ...form, category: v })} />
                        {form.category === 'other' ? <Field value={form.otherName} onChangeText={(v) => setForm({ ...form, otherName: v })} placeholder={tr('What is it? e.g. pest control')} maxLength={60} style={{ marginTop: 6 }} /> : null}
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 10 }}>{tr('Amount (₹)')}</Text>
                        <Field value={form.amount} onChangeText={(v) => setForm({ ...form, amount: v })} placeholder="1500" keyboardType="numeric" maxLength={9} />
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 10 }}>{tr('Date')}</Text>
                        <Field value={form.date} onChangeText={(v) => setForm({ ...form, date: v })} placeholder="2026-11-05" maxLength={10} keyboardType="numbers-and-punctuation" />
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 10 }}>{tr('Paid to (optional)')}</Text>
                        <Field value={form.vendor} onChangeText={(v) => setForm({ ...form, vendor: v })} placeholder={tr('e.g. the vegetable market')} maxLength={80} />
                        <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 10 }}>{tr('Note (optional)')}</Text>
                        <Field value={form.note} onChangeText={(v) => setForm({ ...form, note: v })} maxLength={200} />
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                            <View style={{ flex: 1, paddingRight: 10 }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{tr('Repeats every month')}</Text>
                                <Text style={{ color: muted, fontSize: 12 }}>{tr('For a salary or the shop rent. It counts a share for each day.')}</Text>
                            </View>
                            <SlideSwitch value={form.repeatMonthly} onValueChange={(v) => setForm({ ...form, repeatMonthly: v })} />
                        </View>
                        <Button label={tr('Save')} icon="checkmark" onPress={save} busy={busy} style={{ marginTop: 16 }} />
                        {form.id ? <Button label={tr('Delete this cost')} kind="ghost" icon="trash-outline" onPress={remove} style={{ marginTop: 8 }} /> : null}
                    </ScrollView>
                ) : null}
            </Sheet>
        </View>
    );
}
