// The owner's Plan screen: what he has now, all three plans side by side, and a PREVIEW before anything changes (what turns on or off, the new end date,
// the exact amount). Paying uses the same payment options page as the wallet (UPI app or card). A lower plan starts only when the paid time ends.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, Pill, SectionTitle } from '../../components/owners/ui';
import { fetchPlan, quotePlan, choosePlan, cancelScheduledPlan, quoteBranchPlan, planInvoicePdfPath, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { rupees } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { ask } from '../../components/common/dialog';
import { downloadAndOpen } from '../../utils/owners/files';
import { tr } from '../../i18n';

// Texts the server sends inside the extra-shop quote. They are listed here (never called) so the translation list picks them up; tr() matches the server's real values to these {v1} patterns.
export const _serverQuoteTexts = () => [
    tr('No refund if you remove the shop later.'),
    // the notes and price lines the server writes into the preview (services/planBilling.js)
    tr('Partner starts on {v1} when your paid time ends. Until then you keep {v2}.'), tr('Partner has no monthly price. You pay a small fee per completed order from your wallet.'), tr('{v1} starts when your paid time ends. Until then you keep {v2}. No refund for the rest of the term.'), tr('{v1} starts now and runs until {v2}.'), tr('{v1} runs until {v2}. The price is locked for this term.'), tr('No refund of prepaid months.'), tr('{v1} plan for {v2} month'), tr('{v1} plan for {v2} months'), tr('{v1} to {v2}: Rs {v3} difference x {v4} days left of 30'), tr('{v1} extra shop(s): Rs {v2} a month each, for {v3} month(s)'), tr('{v1} months discount {v2}%'), tr('Wallet balance adjusted (GST already paid on it)'),
    // the feature names of the plan catalog (config/plans.js)
    tr('Rider live map for customers'), tr('Soundbox voice (app only)'), tr('Services and inquiries'), tr('Loyalty and rewards'), tr('Auto-accept orders'), tr('Costs and profit view'), tr('Kitchen and waiter logins'), tr('Bulk orders'), tr('Full exports (customers, orders, items, reports)'), tr('Business analytics and PDF reports'), tr('Custom and daily automatic push'), tr('Multi-branch'), tr('Custom domain'),
    tr('Coupon {v1} {v2}% off'),
    tr('Your {v1} months discount is already better than this coupon, so it is not used.'),
    tr('One more shop can be created. It runs until {v1} with your plan, and is part of your next renewal.'),
    tr('Extra shop: Rs {v1} a month x {v2} of 30 days (the days left of your plan)'),
];

const openInvoice = async (id) => {
    try { await downloadAndOpen({ path: planInvoicePdfPath(id), filename: `invoice-${id}.pdf`, mime: 'application/pdf', title: tr('Invoice') }); }
    catch (e) { showToast(e?.response?.status === 409 ? tr('The invoice is not ready yet') : tr('Could not open the invoice')); }
};
// What each plan gives, in words that sell it. A line with a feature key shows only if the server says the plan has it, so this can never promise more than is enforced.
const COPY = {
    partner: [
        [null, 'Your own online shop, on a website and in the customer app'], [null, 'Your own shopname.vivyaan.co.in link to share'], [null, 'Customers follow their order step by step and can call the rider'],
        [null, 'Dine-in QR tables, waitlist and table booking'], [null, 'Coupons and offers to bring customers back'], [null, 'Online payments and refunds in one place'],
        [null, 'Daily sales summary and your Money tab'], [null, 'Tax invoices for every order'], [null, 'App in Hindi, Marathi, Gujarati, Bengali and more'],
        [null, 'Up to {riders} riders for your own deliveries'],
    ],
    growth: [
        ['riderLiveMap', 'Customers watch the rider live on a map'], [null, 'Unlimited riders'], [null, 'Up to {staff} kitchen and waiter logins'], ['soundboxVoice', 'Soundbox voice announces every new order'],
        ['services', 'Sell services and take inquiries'], ['loyalty', 'Loyalty and rewards to keep customers coming back'], ['autoAccept', 'Auto-accept orders, no waiting'],
        ['costsProfit', 'Costs and profit view, see what you really earn'],
    ],
    pro: [
        ['multiBranch', 'Run up to {shops} shops from one account, and add more whenever you grow'], ['customDomain', 'Your own website name (custom domain)'], [null, 'Unlimited kitchen and waiter logins'],
        ['bulkOrders', 'Take bulk and party orders'], ['analytics', 'Business analytics and PDF reports'], ['customPush', 'Send offers to your customers by push'],
        ['customPush', 'Daily automatic push messages'], ['fullExports', 'Full exports: customers, orders, items and reports'],
    ],
};
const includedLines = (p, prev, o) => {
    const vars = { riders: p.limits.riders, staff: p.limits.staff, shops: o.includedLocations };
    const lines = COPY[p.id].filter(([k]) => !k || p.features[k]).map(([, t]) => tr(t, vars));
    return { head: prev ? tr('Everything in {name}, plus', { name: prev.name }) : null, lines };
};
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const planLine = (c) => {
    if (!c?.id) return tr('No plan yet');
    const name = c.id[0].toUpperCase() + c.id.slice(1);
    if (c.status === 'ended') return tr('{name} ended', { name });
    return c.endsAt ? tr('{name}, ends {date} ({n} days left)', { name, date: day(c.endsAt), n: c.daysLeft }) : name;
};

export default function OwnerPlanScreen() {
    const nav = useNavigation();
    const { background, text, muted, error, ok, primary, border, surface } = useBrand();
    const [o, setO] = useState(null);
    const [pick, setPick] = useState(null);       // plan id being looked at
    const [months, setMonths] = useState('1');
    const [q, setQ] = useState(null);             // the preview for the pick
    const [busy, setBusy] = useState(false);
    const [coupon, setCoupon] = useState('');     // the code applied (tapped on a card or typed)
    const [codeText, setCodeText] = useState('');

    const load = useCallback(async () => { try { setO(await fetchPlan()); } catch (e) { useOwnerStore.getState().noteError(e); } }, []);
    useFocusEffect(useCallback(() => { load(); useMenuFlags.getState().refresh(); }, [load]));

    // the preview is asked from the server every time the choice changes (the same function that charges later)
    useEffect(() => {
        if (!pick) { setQ(null); return undefined; }
        let on = true;
        setQ(null);
        quotePlan({ to: pick, months: Number(months), coupon: coupon || undefined }).then((r) => { if (on) setQ(r); }).catch((e) => { if (on) { showToast(apiError(e)); if (coupon) setCoupon(''); else setPick(null); } });
        return () => { on = false; };
    }, [pick, months, coupon]);

    const cur = o?.current;
    const paid = q && q.totalPaise > 0 && q.kind !== 'downgrade' && q.kind !== 'switch';

    const go = async () => {
        if (!q || busy) return;
        if (paid) { nav.navigate('OwnerPay', { kind: 'plan', to: pick, months: q.months || 1, coupon: q.coupon ? q.coupon.code : undefined, amountPaise: q.totalPaise, payablePaise: q.totalPaise, gstPaise: q.gstPaise, gstPercent: q.gstPercent, title: tr('{name} plan', { name: q.toName }) }); return; }
        const yes = await ask({ title: q.kind === 'downgrade' ? tr('Move to {name} later?', { name: q.toName }) : tr('Switch to {name}?', { name: q.toName }), message: q.notes.map((n) => tr(n)).join('\n'), confirmText: tr('Confirm') });
        if (!yes) return;
        setBusy(true);
        try { await choosePlan({ to: pick, months: Number(months), coupon: coupon || undefined }); showToast(q.kind === 'downgrade' ? tr('Scheduled') : tr('Done')); setPick(null); await load(); useMenuFlags.getState().refresh(); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    // a brand: one more shop. The server works out the price from the days left; he sees it, then pays, then the platform team can create the branch.
    const addShop = async () => {
        try {
            const bq = await quoteBranchPlan();
            const lines = bq.lines.map((l) => `${l.label}: ${rupees(l.paise)}`).join('\n');
            const yes = await ask({ title: tr('Add an extra shop'), message: `${lines}${bq.gstPaise ? `\n${tr('GST {p}%', { p: bq.gstPercent })}: ${rupees(bq.gstPaise)}` : ''}\n${tr('You pay {rupees}', { rupees: rupees(bq.totalPaise) })}\n\n${bq.notes.map(tr).join('\n')}`, confirmText: tr('Pay {rupees}', { rupees: rupees(bq.totalPaise) }) });
            if (yes) nav.navigate('OwnerPay', { kind: 'branchshop', amountPaise: bq.totalPaise, payablePaise: bq.totalPaise, gstPaise: bq.gstPaise, gstPercent: bq.gstPercent, title: tr('Extra shop') });
        } catch (e) { showToast(apiError(e)); }
    };
    const cancelMove = async () => { try { await cancelScheduledPlan(); showToast(tr('Cancelled')); load(); } catch (e) { showToast(apiError(e)); } };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Plan')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 40 }}>
                {!o ? <ListShimmer count={3} rows /> : (
                    <>
                        <Card tone={cur?.status === 'ended' ? error : undefined}>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{cur?.status === 'ended' ? tr('Choose your plan') : tr('Your plan')}</Text>
                            <Text style={{ color: text, fontSize: 22, fontWeight: '900', marginTop: 2 }}>{planLine(cur)}</Text>
                            {cur?.id === 'partner' && o.wallet ? (
                                <Pressable onPress={() => nav.navigate('OwnerWallet')}><Text style={{ color: primary, marginTop: 6, fontWeight: '800' }}>{tr('Wallet {rupees}. Open the wallet', { rupees: rupees(o.wallet.balancePaise) })}</Text></Pressable>
                            ) : null}
                            {o.scheduled ? (
                                <View style={{ marginTop: 8 }}>
                                    <Text style={{ color: muted }}>{tr('{name} starts on {date}', { name: o.scheduled.to[0].toUpperCase() + o.scheduled.to.slice(1), date: day(o.scheduled.at) })}</Text>
                                    <Pressable onPress={cancelMove}><Text style={{ color: primary, fontWeight: '800', marginTop: 4 }}>{tr('Cancel this move')}</Text></Pressable>
                                </View>
                            ) : null}
                        </Card>

                        {o.brand ? (
                            <>
                                <SectionTitle title={tr('Your shops')} />
                                <Card>
                                    <Text style={{ color: text, fontWeight: '800' }}>{tr('{used} of {capacity} shops used', { used: o.brand.used, capacity: o.brand.capacity })}</Text>
                                    <Text style={{ color: muted, marginTop: 4 }}>{tr('{n} shops are free. Each extra shop is {rupees} a month + GST, paid before the shop is created.', { n: o.brand.includedLocations, rupees: rupees(o.brand.addonPaise) })}</Text>
                                    <View style={{ marginTop: 10 }}><Button label={tr('Add an extra shop')} icon="storefront" kind="ghost" onPress={addShop} /></View>
                                </Card>
                            </>
                        ) : null}

                        <SectionTitle title={tr('Compare plans')} />
                        {o.plans.map((p) => {
                            const isCur = cur?.id === p.id; const sel = pick === p.id;
                            return (
                                <Pressable key={p.id} onPress={() => { setPick(sel ? null : p.id); setMonths('1'); }} style={{ marginHorizontal: 16, marginBottom: 10 }}>
                                    <View style={{ backgroundColor: surface, borderRadius: 16, padding: 14, borderWidth: 2, borderColor: sel ? primary : border }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text style={{ color: text, fontSize: 18, fontWeight: '900', flex: 1 }}>{p.name}</Text>
                                            {isCur ? <Pill label={tr('Current')} color={ok} /> : null}
                                        </View>
                                        <Text style={{ color: muted, marginTop: 2 }}>
                                            {p.id === 'partner' ? tr('No monthly price. Rs {min} to Rs {max} per completed order from your wallet.', { min: p.feeRange.minRs, max: p.feeRange.maxRs }) + '*'
                                                : tr('{rupees} + GST per month', { rupees: rupees(p.pricePaise) }) + '*'}
                                        </Text>
                                        {sel || isCur ? (
                                            <View style={{ marginTop: 8 }}>
                                                {(() => {
                                                    const inc = includedLines(p, o.plans[o.plans.findIndex((x) => x.id === p.id) - 1], o);
                                                    return (
                                                        <>
                                                            {inc.head ? <Text style={{ color: text, fontWeight: '800', fontSize: 13 }}>{inc.head}</Text> : null}
                                                            {inc.lines.map((l) => (
                                                                <View key={l} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                                                    <Ionicons name="checkmark-circle" size={16} color={ok} />
                                                                    <Text style={{ color: text, marginLeft: 6, fontSize: 13, flex: 1 }}>{l}</Text>
                                                                </View>
                                                            ))}
                                                        </>
                                                    );
                                                })()}
                                            </View>
                                        ) : <Text style={{ color: primary, marginTop: 6, fontSize: 12, fontWeight: '800' }}>{tr('Tap to see everything and the price')}</Text>}
                                    </View>
                                </Pressable>
                            );
                        })}

                        {pick && pick !== 'partner' && q?.kind !== 'upgrade' && q?.kind !== 'downgrade' ? (
                            <View style={{ paddingHorizontal: 16, marginBottom: 14 }}>
                                <Text style={{ color: muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{tr('How many months')}</Text>
                                <Chips options={['1', '2', '3', '4', '5', '6'].map((m) => [m, `${m}${o.discounts[m] ? ` · ${o.discounts[m]}% off` : ''}`])} value={months} onChange={setMonths} style={{ marginTop: 0 }} />
                                {(o.coupons || []).filter((c) => c.plans.includes(pick)).map((c) => {
                                    const on = coupon === c.code;
                                    return (
                                        <Pressable key={c.id} onPress={() => { if (on) { setCoupon(''); return; } if (c.months.length && !c.months.includes(Number(months))) setMonths(String(c.months[0])); setCoupon(c.code); }}
                                            style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderStyle: 'dashed', borderColor: on ? ok : primary, backgroundColor: alpha(on ? ok : primary, 0.08) }}>
                                            <Ionicons name={on ? 'checkmark-circle' : 'pricetag'} size={22} color={on ? ok : primary} />
                                            <View style={{ flex: 1, marginHorizontal: 10 }}>
                                                <Text style={{ color: text, fontWeight: '900' }}>{c.code} · {tr('{p}% off', { p: c.pct })}</Text>
                                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{(c.months.length ? tr('For {m} months', { m: c.months.join(' / ') }) + ' · ' : '') + tr('Valid till {date}', { date: day(c.endsAt) })}</Text>
                                            </View>
                                            <Text style={{ color: on ? ok : primary, fontWeight: '800' }}>{on ? tr('Applied') : tr('Tap to apply')}</Text>
                                        </Pressable>
                                    );
                                })}
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                                    <TextInput value={codeText} onChangeText={(t) => setCodeText(t.toUpperCase())} placeholder={tr('Have a coupon code?')} placeholderTextColor={muted} autoCapitalize="characters" autoCorrect={false}
                                        style={{ flex: 1, color: text, borderWidth: 1, borderColor: border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 }} />
                                    <Pressable onPress={() => { const t = codeText.trim(); if (t) { setCoupon(t); setCodeText(''); } }} style={{ marginLeft: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, backgroundColor: primary }}>
                                        <Text style={{ color: '#fff', fontWeight: '800' }}>{tr('Apply')}</Text>
                                    </Pressable>
                                </View>
                            </View>
                        ) : null}

                        {pick ? (
                            <Card>
                                <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('Before you confirm')}</Text>
                                {!q ? <ListShimmer count={2} rows /> : (
                                    <>
                                        {q.features.on.length ? <Text style={{ color: text, marginTop: 6 }}>{tr('Turns on: {list}.', { list: q.features.on.map(tr).join(', ') })}</Text> : null}
                                        {q.features.off.length ? <Text style={{ color: error, marginTop: 6 }}>{tr('Turns off: {list}.', { list: q.features.off.map(tr).join(', ') })}</Text> : null}
                                        {q.lines.map((l, i) => (
                                            <View key={i} style={{ flexDirection: 'row', marginTop: 6 }}>
                                                <Text style={{ color: text, flex: 1 }}>{tr(l.label)}</Text>
                                                <Text style={{ color: l.paise < 0 ? ok : text, fontWeight: '800' }}>{l.paise < 0 ? '−' : ''}{rupees(Math.abs(l.paise))}</Text>
                                            </View>
                                        ))}
                                        {q.gstPaise ? (
                                            <View style={{ flexDirection: 'row', marginTop: 6 }}><Text style={{ color: muted, flex: 1 }}>{tr('GST {p}%', { p: q.gstPercent })}</Text><Text style={{ color: text, fontWeight: '800' }}>{rupees(q.gstPaise)}</Text></View>
                                        ) : null}
                                        {q.kind !== 'downgrade' && q.kind !== 'switch' ? (
                                            <View style={{ flexDirection: 'row', marginTop: 10, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: border }}>
                                                <Text style={{ color: text, flex: 1, fontWeight: '900', fontSize: 16 }}>{tr('You pay')}</Text>
                                                <Text style={{ color: text, fontWeight: '900', fontSize: 18 }}>{rupees(q.totalPaise)}</Text>
                                            </View>
                                        ) : null}
                                        {q.notes.map((n, i) => <Text key={i} style={{ color: muted, marginTop: 6, fontSize: 12 }}>{tr(n)}</Text>)}
                                        <View style={{ marginTop: 12 }}>
                                            <Button label={paid ? tr('Pay {rupees}', { rupees: rupees(q.totalPaise) }) : q.kind === 'downgrade' ? tr('Move at the end of my plan') : tr('Confirm')} icon={paid ? 'card' : 'checkmark'} loading={busy} onPress={go} />
                                        </View>
                                    </>
                                )}
                            </Card>
                        ) : null}

                        {o.payments.length ? (
                            <>
                                <SectionTitle title={tr('Payments')} />
                                <Card>
                                    {o.payments.map((p) => (
                                        <View key={p.id} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                            <Text style={{ color: text, flex: 1 }}>{p.to[0].toUpperCase() + p.to.slice(1)}{p.months ? ` × ${p.months}` : ''} · {p.paidAt ? day(p.paidAt) : ''}{p.status === 'held' ? ` · ${tr('being checked')}` : ''}</Text>
                                            {p.status === 'paid' ? <Pressable onPress={() => openInvoice(p.id)} hitSlop={8} style={{ marginRight: 10 }}><Text style={{ color: primary, fontWeight: '700' }}>{tr('Invoice (PDF)')}</Text></Pressable> : null}
                                            <Text style={{ color: text, fontWeight: '800' }}>{rupees(p.payablePaise)}</Text>
                                        </View>
                                    ))}
                                </Card>
                            </>
                        ) : null}
                        <Text style={{ color: muted, fontSize: 12, marginHorizontal: 16, marginTop: 12 }}>{tr('Need help choosing? Open Help and support and we will set it up for you.')}</Text>
                        <Text style={{ color: muted, fontSize: 11, marginHorizontal: 16, marginTop: 10, marginBottom: 24 }}>{tr('* All payments, including plan fees, extra shops and wallet top-ups, are non-refundable. Prepaid plan time and wallet balance cannot be returned or cashed out.')}</Text>
                    </>
                )}
            </ScrollView>
        </View>
    );
}
