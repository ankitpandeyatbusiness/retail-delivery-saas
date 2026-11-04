// Costs and profit: what the shop spends (ingredients, salaries, shop rent...), and what it really kept after them, the rent and the SMS paid to the platform.
// A cost that repeats every month (a salary, the shop rent) counts a share for each day, so any period gives a fair profit.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, SectionTitle, Row, Sheet, Field, Empty, money } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import SlideSwitch from '../../components/common/SlideSwitch';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { StatShimmer } from '../../components/owners/shimmer';
import { fetchCosts, addCost, updateCost, deleteCost, fetchProfit, apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

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
    const { background, text, muted, primary, error, success } = useBrand();
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
    useEffect(() => { setP(null); setList(null); }, [which]);

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
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['month', tr('This month')], ['lastmonth', tr('Last month')], ['7', tr('7 days')], ['30', tr('30 days')]]} value={which} onChange={setWhich} style={{ marginTop: 0 }} />
                </View>
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {!p && !err ? <StatShimmer /> : null}
                {p ? (
                    <>
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{p.from === p.to ? p.from : `${p.from} - ${p.to}`}</Text>
                            <Text style={{ color: p.profit >= 0 ? success : error, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(p.profit)}</Text>
                            <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{p.profit >= 0 ? tr('Profit') : tr('Loss')}{p.marginPct !== null ? ` · ${p.marginPct}%` : ''}</Text>
                            {p.before && (p.before.revenue || p.before.costs) ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('The period before: {amount}', { amount: money(p.before.profit) })}</Text> : null}
                        </Card>

                        <SectionTitle title={tr('Where the money went')} />
                        <Card>
                            <MoneyRow title={tr('Sales')} note={tr('{n} orders delivered', { n: p.sales.orders })} value={money(p.sales.revenue)} />
                            {p.costs.items.map((i) => <MoneyRow key={i.key} title={tr(i.label)} value={`- ${money(i.amount)}`} />)}
                            {p.costs.rentPaid ? <MoneyRow title={tr('Rent paid to the platform')} value={`- ${money(p.costs.rentPaid)}`} /> : null}
                            {p.costs.smsPaid ? <MoneyRow title={tr('SMS top-ups')} value={`- ${money(p.costs.smsPaid)}`} /> : null}
                            <MoneyRow title={tr('Profit')} value={money(p.profit)} color={p.profit >= 0 ? success : error} last />
                        </Card>
                    </>
                ) : null}

                <View style={{ paddingHorizontal: 16, marginTop: 12 }}><Button label={tr('Add a cost')} icon="add" onPress={() => setForm(blank())} /></View>

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
            </ScrollView>

            <Sheet visible={!!form} onClose={() => setForm(null)} title={form && form.id ? tr('Change a cost') : tr('Add a cost')}>
                {form ? (
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
