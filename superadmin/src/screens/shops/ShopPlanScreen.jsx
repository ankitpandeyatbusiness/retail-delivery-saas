import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, Badge, Chip, Button } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ConfirmSheet, toast } from '../../components/feedback';
import { DatePickField } from '../../components/DatePicker';
import { recordPlanPaymentQuote, recordPlanPayment, extendShopPlan, fetchPlanCatalog, fetchShopPlan, removeShopPlan, setShopPlan, setShopPlanExtra, setShopPlanTerms, fetchShopWallet, adjustShopWallet, endShopFreePeriod } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { planLine } from '../../components/shopBits';
import PlanPreview from '../../components/PlanPreview';
import OwnerMenuPreview from '../../components/preview/OwnerMenuPreview';
import { dateTime } from '../../utils/format';

const NAMES = { partner: 'Partner', growth: 'Growth', pro: 'Pro' };
const priceText = (c, id) => (id === 'partner' ? 'Rs 0 rent, Rs 3 to Rs 15 per order from a prepaid wallet' : `Rs ${(c.defaults[id].pricePaise / 100).toLocaleString('en-IN')} + GST per 30 days`);

// One shop's plan. Only the supreme admin can change anything (the server refuses everyone else). Switching is instant and audit-logged.
export default function ShopPlanScreen() {
    const t = useTheme();
    const { shopId } = useRoute().params;
    const nav = useNavigation();
    const tenant = useShopStore((s) => s.byId[shopId])?.tenant;
    const [cat, setCat] = useState(null);
    const [plan, setPlan] = useState(null);
    const [pick, setPick] = useState(null);        // the plan chip waiting for confirmation
    const [look, setLook] = useState(null);        // the plan chip being previewed (nothing changes until Switch is confirmed)
    const [extra, setExtra] = useState(null);      // { key, on } waiting for confirmation
    const [days, setDays] = useState('');
    const [busy, setBusy] = useState(false);
    const [wallet, setWallet] = useState(null);     // the Partner wallet (balance, last movements, ledger check)
    const [adj, setAdj] = useState(null);           // 'add' | 'take' waiting for the amount and the reason
    const [adjAmt, setAdjAmt] = useState('');
    const [freeDays, setFreeDays] = useState('');   // the days of a free period to start
    const [startFree, setStartFree] = useState(null);   // 'growth' | 'pro' waiting for confirmation
    const [removing, setRemoving] = useState(false);
    // record a payment made outside the app
    const [rp, setRp] = useState({ to: 'growth', months: 1, amount: '', method: 'bank', reference: '' });
    const [rpQuote, setRpQuote] = useState(null);
    const [rpSure, setRpSure] = useState(false);
    // more time
    const [moreDays, setMoreDays] = useState('');
    const [moreOn, setMoreOn] = useState('');
    const [moreSure, setMoreSure] = useState(false);
    // this shop's own terms
    const [terms, setTerms] = useState(null);   // { price, freeDays, slabs: [{ upTo, fee }] }
    const [termsSure, setTermsSure] = useState(false);
    const [removing2, setRemoving2] = useState(false);     // the "Remove the plan" confirm
    const [endFree, setEndFree] = useState(false);   // the "End the free period now" confirm

    const load = useCallback(async () => {
        try { const [c, p, wl] = await Promise.all([fetchPlanCatalog(), fetchShopPlan(shopId), fetchShopWallet(shopId).catch(() => null)]); setCat(c); setPlan(p); setWallet(wl?.partner ? wl : null); setDays(''); } catch (e) { toast(errMsg(e), 'error'); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        if (!plan || terms) return;
        const tm = plan.terms || {};
        setTerms({ price: tm.pricePaise != null ? String(tm.pricePaise / 100) : '', freeDays: tm.freeDays != null ? String(tm.freeDays) : '', slabs: (tm.feeSlabs || []).map((x) => ({ upTo: x.upTo === null ? '' : String(x.upTo), fee: String(x.feeRs) })) });
    }, [plan, terms]);
    useEffect(() => {
        let on = true;
        setRpQuote(null);
        recordPlanPaymentQuote(shopId, rp.to, rp.months).then((q) => { if (on) setRpQuote(q); }).catch(() => { if (on) setRpQuote(false); });
        return () => { on = false; };
    }, [shopId, rp.to, rp.months, plan && plan.id, plan && plan.endsAt]);

    if (!cat || !plan) return <Screen title="Plan" subtitle={tenant?.name}><SkeletonList count={4} /></Screen>;

    const run = async (fn, ok) => {
        setBusy(true);
        try { const r = await fn(); setPlan(r); toast(ok); fetchShopWallet(shopId).then((wl) => setWallet(wl?.partner ? wl : null)).catch(() => setWallet(null)); useShopStore.getState().load(shopId, { quiet: true }); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(false); }
    };
    const outside = Object.entries(cat.features).filter(([, f]) => plan.id && !f.plans.includes(plan.id));   // features this plan does not include
    const lost = pick ? Object.values(cat.features).filter((f) => plan.id && f.plans.includes(plan.id) && !f.plans.includes(pick)).map((f) => f.label) : [];
    const gained = pick ? Object.values(cat.features).filter((f) => f.plans.includes(pick) && !(plan.id && f.plans.includes(plan.id))).map((f) => f.label) : [];
    const switchMsg = pick
        ? `${gained.length ? `Turns on: ${gained.join(', ')}.\n` : ''}${lost.length ? `Turns off: ${lost.join(', ')}.\n` : ''}${pick === 'partner' ? 'Partner has no end date; the shop pays per order from its wallet.' : `${days || cat.defaults.freeDays} free days start now, no invoice.`}\nThis happens at once and is written to the audit log.`
        : '';

    return (
        <Screen title="Plan" subtitle={tenant?.name}>
            <Card>
                <Text style={{ color: t.muted, fontSize: font.sm }}>Running now</Text>
                <Text style={{ color: t.text, fontSize: font.xl, fontWeight: '800', marginTop: 2 }}>{plan.id ? planLine(plan) : 'No plan yet (old shop, nothing limited)'}</Text>
                {plan.id && plan.endsAt ? <Text style={{ color: t.muted, marginTop: spacing.xs }}>{plan.status === 'free' ? 'Free period' : 'Paid period'} until {dateTime(plan.endsAt)} ({plan.daysLeft} days left)</Text> : null}
                {plan.id ? <Text style={{ color: t.muted, marginTop: spacing.xs }}>Riders: {plan.limits.riders ?? 'unlimited'}. Kitchen and waiter logins: {plan.limits.staff ?? 'unlimited'}.</Text> : null}
            </Card>

            {wallet ? (
                <>
                    <SectionTitle section="money">Wallet (Partner)</SectionTitle>
                    <Card>
                        <Text style={{ color: wallet.balancePaise < 0 ? t.danger : t.text, fontSize: font.xl, fontWeight: '800' }}>Rs {(wallet.balancePaise / 100).toFixed(2)}</Text>
                        <Text style={{ color: t.muted, marginTop: spacing.xs }}>
                            {wallet.canTakeOrders ? 'Taking orders' : 'New orders stopped (wallet and overdraft used up)'}. Overdraft Rs {(wallet.overdraftPaise / 100).toFixed(0)}. Fees this month Rs {(wallet.feesThisMonth.paise / 100).toFixed(0)} for {wallet.feesThisMonth.orders} orders.
                        </Text>
                        <Text style={{ color: wallet.check.differencePaise === 0 ? t.muted : t.danger, marginTop: spacing.xs }}>{wallet.check.differencePaise === 0 ? 'Ledger matches the balance' : `Ledger differs by Rs ${(wallet.check.differencePaise / 100).toFixed(2)}. Check it.`}</Text>
                        {wallet.items.slice(0, 5).map((r) => (
                            <Text key={r.id} style={{ color: t.text, marginTop: spacing.xs, fontSize: font.sm }}>
                                {r.type === 'fee' ? `Order #${r.orderNo}, Rs ${r.baseRs}, fee Rs ${-r.amountPaise / 100}` : `${r.type}${r.note ? ': ' + r.note : ''} ${r.amountPaise > 0 ? '+' : '-'}Rs ${Math.abs(r.amountPaise) / 100}`}
                            </Text>
                        ))}
                        <Field label="Correction amount in Rs" value={adjAmt} onChangeText={(v) => setAdjAmt(v.replace(/[^\d.]/g, '').slice(0, 8))} keyboardType="decimal-pad" />
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm }}>
                            <Button title="Add money" kind="soft" small onPress={() => (Number(adjAmt) > 0 ? setAdj('add') : toast('Type an amount first', 'error'))} />
                            <Button title="Take money" kind="dangerSoft" small onPress={() => (Number(adjAmt) > 0 ? setAdj('take') : toast('Type an amount first', 'error'))} />
                        </View>
                    </Card>
                </>
            ) : null}

            <SectionTitle section="settings">Free period</SectionTitle>
            <Card>
                {plan.id && plan.status === 'free' ? (
                    <>
                        <Text style={{ color: t.text, marginBottom: spacing.sm }}>A free period is running until {dateTime(plan.endsAt)} ({plan.daysLeft} days left).</Text>
                        <Button title="End the free period now" kind="dangerSoft" icon="bolt" small onPress={() => setEndFree(true)} />
                    </>
                ) : (
                    <Text style={{ color: t.muted }}>{plan.id ? 'No free period is running.' : 'This shop has no plan.'} Start one below: the shop gets the plan for the days you type, no invoice. When it ends, the owner chooses and pays.</Text>
                )}
                <Field label={plan.status === 'free' ? 'Start a new free period (replaces this one)' : 'Free days to start'} placeholder="e.g. 14" value={freeDays} onChangeText={(v) => setFreeDays(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" maxLength={3} style={{ marginTop: spacing.md }} />
                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <Button title="Start free Growth" kind="soft" small disabled={!(Number(freeDays) > 0)} onPress={() => setStartFree('growth')} />
                    <Button title="Start free Pro" kind="soft" small disabled={!(Number(freeDays) > 0)} onPress={() => setStartFree('pro')} />
                </View>
            </Card>

            <SectionTitle section="settings">Change plan</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {cat.ids.map((id) => <Chip key={id} label={NAMES[id]} active={(look || plan.id) === id} onPress={() => setLook(plan.id === id ? null : id)} />)}
                </View>
                <Text style={{ color: t.muted, marginTop: spacing.md }}>{plan.id ? priceText(cat, plan.id) : 'Pick a plan to start.'}</Text>
                <Field label="Free days for the new plan (empty = platform default)" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
            </Card>

            {plan.id ? (
                <>
                    <SectionTitle section="money">Remove the plan</SectionTitle>
                    <Card>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Takes every plan away from this shop. It then has no plan: nothing is locked, no plan reminders, no pause. The owner is asked to choose a plan. The shop's own price, free days and website/app switches stay. Money already paid is not returned (use Send money back below for that).</Text>
                        <Button title="Remove the plan" kind="dangerSoft" onPress={() => setRemoving(true)} />
                    </Card>
                </>
            ) : null}

            <SectionTitle section="money">Record a payment made outside the app</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, marginBottom: spacing.sm }}>The owner paid you by bank transfer, UPI or cash. Record what you received: the plan starts for the term, a tax invoice is made and the money screens show it. Nothing goes to Razorpay, so it cannot be refunded with Send money back.</Text>
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm }}>
                    {['growth', 'pro'].map((id) => <Chip key={id} label={NAMES[id]} active={rp.to === id} onPress={() => setRp({ ...rp, to: id, amount: '' })} />)}
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
                    {[1, 2, 3, 4, 5, 6].map((m) => <Chip key={m} label={`${m} month${m > 1 ? 's' : ''}`} active={rp.months === m} onPress={() => setRp({ ...rp, months: m, amount: '' })} />)}
                </View>
                {rpQuote ? <Text style={{ color: t.text, marginBottom: spacing.sm }}>Price with GST: Rs {(rpQuote.suggestedPaise / 100).toLocaleString('en-IN')}. Runs until {dateTime(rpQuote.endsAt)}.</Text> : rpQuote === false ? <Text style={{ color: t.warn, marginBottom: spacing.sm }}>This plan cannot be recorded for this shop now (a lower plan waits for the end, or a prepaid plan is waiting).</Text> : null}
                <Field label="Amount received (Rs, GST included)" placeholder={rpQuote ? String(rpQuote.suggestedPaise / 100) : ''} value={rp.amount} onChangeText={(v) => setRp({ ...rp, amount: v.replace(/[^0-9.]/g, '').slice(0, 9) })} keyboardType="decimal-pad" />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
                    {[['bank', 'Bank transfer'], ['upi', 'UPI'], ['cash', 'Cash'], ['other', 'Other']].map(([k, l]) => <Chip key={k} label={l} active={rp.method === k} onPress={() => setRp({ ...rp, method: k })} />)}
                </View>
                <Field label="Reference" placeholder="Bank reference, UPI id or a note" value={rp.reference} onChangeText={(v) => setRp({ ...rp, reference: v })} maxLength={120} />
                <Button title="Record the payment" kind="soft" disabled={!rpQuote || !(Number(rp.amount || (rpQuote && rpQuote.suggestedPaise / 100)) >= 1) || rp.reference.trim().length < 3} onPress={() => setRpSure(true)} />
            </Card>

            <SectionTitle section="settings">Give more time</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Add days to the end of the plan (a goodwill gesture, a payment sorted out by phone). A shop that ended or was paused opens again. It can only move the end later.</Text>
                <Field label="Days to add" placeholder="e.g. 7" value={moreDays} onChangeText={(v) => { setMoreDays(v.replace(/\D/g, '').slice(0, 3)); setMoreOn(''); }} keyboardType="number-pad" maxLength={3} />
                <DatePickField label="Or set the end day" value={moreOn} onChange={(v) => { setMoreOn(v); setMoreDays(''); }} title="New end day" />
                <Button title="Give more time" kind="soft" disabled={!plan.id || plan.id === 'partner' || !(Number(moreDays) > 0 || moreOn)} onPress={() => setMoreSure(true)} />
                {!plan.id || plan.id === 'partner' ? <Text style={{ color: t.muted, marginTop: spacing.sm }}>Only a Growth or Pro plan has an end date.</Text> : null}
            </Card>

            {terms ? (
                <>
                    <SectionTitle section="money">This shop's own terms</SectionTitle>
                    <Card>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Leave a field empty to use the platform value. Changes apply to what this shop is quoted from now on; what it already paid stays.</Text>
                        <Field label="Special monthly price (Rs, before GST)" placeholder="Platform price" value={terms.price} onChangeText={(v) => setTerms({ ...terms, price: v.replace(/[^0-9]/g, '').slice(0, 6) })} keyboardType="number-pad" />
                        <Field label="Free days for this shop" placeholder="Platform default" value={terms.freeDays} onChangeText={(v) => setTerms({ ...terms, freeDays: v.replace(/\D/g, '').slice(0, 3) })} keyboardType="number-pad" />
                        <Text style={{ color: t.text, fontWeight: '700', marginBottom: spacing.xs }}>Partner fee per order (own slabs)</Text>
                        {terms.slabs.length ? terms.slabs.map((sl, i) => (
                            <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
                                <View style={{ flex: 1 }}>{i === terms.slabs.length - 1 ? <Field label="Above the last amount" value="open ended" editable={false} /> : <Field label="Order value up to Rs" value={sl.upTo} onChangeText={(v) => setTerms({ ...terms, slabs: terms.slabs.map((x, j) => (j === i ? { ...x, upTo: v.replace(/\D/g, '').slice(0, 6) } : x)) })} keyboardType="number-pad" />}</View>
                                <View style={{ flex: 1 }}><Field label="Fee Rs" value={sl.fee} onChangeText={(v) => setTerms({ ...terms, slabs: terms.slabs.map((x, j) => (j === i ? { ...x, fee: v.replace(/\D/g, '').slice(0, 2) } : x)) })} keyboardType="number-pad" /></View>
                            </View>
                        )) : <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Using the platform slabs.</Text>}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm }}>
                            {!terms.slabs.length ? <Button title="Set own slabs" kind="outline" small onPress={() => setTerms({ ...terms, slabs: [{ upTo: '150', fee: '3' }, { upTo: '', fee: '6' }] })} /> : null}
                            {terms.slabs.length < 10 && terms.slabs.length ? <Button title="Add a slab" kind="outline" small onPress={() => setTerms({ ...terms, slabs: [...terms.slabs.slice(0, -1), { upTo: '', fee: '6' }, terms.slabs[terms.slabs.length - 1]] })} /> : null}
                            {terms.slabs.length ? <Button title="Use platform slabs" kind="outline" small onPress={() => setTerms({ ...terms, slabs: [] })} /> : null}
                        </View>
                        <Button title="Save this shop's terms" kind="soft" onPress={() => setTermsSure(true)} />
                    </Card>
                </>
            ) : null}

            <SectionTitle section="money">Emergency</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Send real money back to this shop's payment method: the unused part of its plan, its wallet balance or its SMS balance.</Text>
                <Button title="Send money back" kind="outline" icon="cash-outline" onPress={() => nav.navigate('ShopRefund', { shopId })} />
            </Card>

            <SectionTitle section="shops">{look ? `Preview: ${NAMES[look]}` : 'How the shop looks now'}</SectionTitle>
            {(look || plan.id) ? <PlanPreview shopId={shopId} plan={look || plan.id} freeDays={look ? days : undefined} title={look ? `If you switch to ${NAMES[look]}` : undefined} /> : null}
            {(look || plan.id) ? <OwnerMenuPreview shopId={shopId} plan={look || plan.id} freeDays={look ? days : undefined} /> : null}
            {look ? <Button title={`Switch to ${NAMES[look]}`} onPress={() => setPick(look)} style={{ marginTop: spacing.sm }} /> : null}

            {plan.id ? (
                <>
                    <SectionTitle section="catalog">Features outside this plan</SectionTitle>
                    <Card>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Switching one on gives this shop a feature its plan does not include. It is tagged "extra" and written to the audit log.</Text>
                        {outside.length ? outside.map(([key, f]) => {
                            const on = plan.extras.includes(key);
                            return (
                                <View key={key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}>
                                    <Text style={{ color: t.text, flex: 1 }}>{f.label}</Text>
                                    {on && plan.keptUntil && plan.keptUntil[key] ? <Text style={{ color: t.muted, fontSize: font.sm, marginRight: spacing.sm }}>kept until {dateTime(plan.keptUntil[key])}</Text> : null}
                                    {on ? <Badge label="Extra" tone="warn" /> : null}
                                    <Switch value={on} disabled={busy} onValueChange={(v) => setExtra({ key, on: v })} />
                                </View>
                            );
                        }) : <Text style={{ color: t.muted }}>Everything is already in this plan.</Text>}
                    </Card>

                    <SectionTitle section="platform">Website and app</SectionTitle>
                    <Card>
                        {[['webEnabled', 'Website (shopname.vivyaan.co.in)'], ['nativeEnabled', 'Mobile app']].map(([k, label]) => (
                            <View key={k} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xs }}>
                                <Text style={{ color: t.text, flex: 1 }}>{label}</Text>
                                <Switch value={plan[k]} disabled={busy} onValueChange={(v) => run(() => setShopPlanTerms(shopId, { [k]: v }), v ? 'Switched on' : 'Switched off').catch(() => { })} />
                            </View>
                        ))}
                        <Text style={{ color: t.muted, marginTop: spacing.sm }}>Website off: the website says the shop is on its app only. App off: the installed app tells customers the shop is now on the website, with a button. Both off: both say temporarily unavailable. Owners, riders and staff are not affected.</Text>
                    </Card>
                </>
            ) : null}

            <ConfirmSheet
                visible={!!pick}
                onClose={() => setPick(null)}
                title={`Switch to ${NAMES[pick] || ''}?`}
                message={switchMsg}
                confirmLabel="Switch plan"
                onConfirm={() => run(() => setShopPlan(shopId, { to: pick, ...(days !== '' ? { freeDays: Number(days) } : {}) }), `Now on ${NAMES[pick]}`).then(() => setLook(null))}
            />
            <ConfirmSheet
                visible={!!startFree}
                onClose={() => setStartFree(null)}
                title={`Start ${NAMES[startFree] || ''} free for ${freeDays} days?`}
                message={`The shop gets ${NAMES[startFree] || ''} at once for ${freeDays} days, with no invoice. Any plan it has now is replaced. When the days end, the owner is told and has to choose and pay. This is written to the audit log.`}
                confirmLabel="Start it"
                onConfirm={() => run(() => setShopPlan(shopId, { to: startFree, freeDays: Number(freeDays) }), `${NAMES[startFree]} free for ${freeDays} days`).then(() => { setFreeDays(''); setLook(null); })}
            />
            <ConfirmSheet
                visible={removing}
                onClose={() => setRemoving(false)}
                title="Remove the plan from this shop?"
                message="The shop will have no plan. Nothing is locked and no plan reminders are sent. The owner is told 'Changed by the Platform' and has to choose a plan. A payment that was waiting is closed."
                confirmLabel="Remove the plan"
                danger
                onConfirm={() => run(() => removeShopPlan(shopId), 'Plan removed')}
            />
            <ConfirmSheet
                visible={rpSure}
                onClose={() => setRpSure(false)}
                title={`Record Rs ${rp.amount || (rpQuote ? rpQuote.suggestedPaise / 100 : '')} for ${NAMES[rp.to]}?`}
                message={`${NAMES[rp.to]} for ${rp.months} month${rp.months > 1 ? 's' : ''} starts now${rpQuote ? `, runs until ${dateTime(rpQuote.endsAt)}` : ''}. A tax invoice is made for the amount you received, and the owner is told. This is written to the audit log.`}
                confirmLabel="Record it"
                onConfirm={() => run(() => recordPlanPayment(shopId, { to: rp.to, months: rp.months, receivedPaise: Math.round(Number(rp.amount || (rpQuote ? rpQuote.suggestedPaise / 100 : 0)) * 100), method: rp.method, reference: rp.reference.trim() }).then((r) => r.plan), 'Payment recorded').then(() => { setRp({ ...rp, amount: '', reference: '' }); load(); })}
            />
            <ConfirmSheet
                visible={moreSure}
                onClose={() => setMoreSure(false)}
                title="Give this shop more time?"
                message={moreOn ? `The plan will run until the end of ${moreOn}.` : `${moreDays} day${Number(moreDays) > 1 ? 's' : ''} are added after the current end.`}
                confirmLabel="Give more time"
                onConfirm={() => run(() => extendShopPlan(shopId, moreOn ? { endsOn: moreOn } : { days: Number(moreDays) }), 'Plan extended').then(() => { setMoreDays(''); setMoreOn(''); load(); })}
            />
            <ConfirmSheet
                visible={termsSure}
                onClose={() => setTermsSure(false)}
                title="Save this shop's own terms?"
                message="From now on this shop is quoted with these. Empty fields go back to the platform values."
                confirmLabel="Save"
                onConfirm={() => run(() => setShopPlanTerms(shopId, {
                    pricePaise: terms.price === '' ? null : Number(terms.price) * 100, freeDays: terms.freeDays === '' ? null : Number(terms.freeDays),
                    feeSlabs: terms.slabs.length ? terms.slabs.map((x, i) => ({ upTo: i === terms.slabs.length - 1 ? null : Number(x.upTo), feeRs: Number(x.fee) })) : null,
                }), 'Terms saved').then(() => { setTerms(null); load(); })}
            />
            <ConfirmSheet
                visible={!!adj}
                onClose={() => setAdj(null)}
                title={adj === 'add' ? 'Add money to the wallet' : 'Take money from the wallet'}
                message="A manual correction. It is written to the wallet ledger and the audit log with your reason."
                confirmLabel={adj === 'add' ? 'Add' : 'Take'}
                danger={adj === 'take'}
                needReason
                reasonLabel="Reason (the owner sees it in the wallet history)"
                onConfirm={async (reason) => {
                    const rs = Math.round(Number(adjAmt) * 100);
                    if (!(rs > 0)) { toast('Type an amount first', 'error'); throw new Error('amount'); }
                    try { await adjustShopWallet(shopId, { direction: adj, amountPaise: rs, note: reason }); toast('Wallet updated'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
            <ConfirmSheet
                visible={endFree}
                onClose={() => setEndFree(false)}
                title="End the free period now?"
                message="The plan ends at once and the grace days start. The owner is told and has to choose and pay. A paid term is never touched."
                confirmLabel="End it"
                danger
                onConfirm={() => run(() => endShopFreePeriod(shopId), 'Free period ended')}
            />
            <ConfirmSheet
                visible={!!extra}
                onClose={() => setExtra(null)}
                title={extra?.on ? 'Give this feature outside the plan?' : 'Remove this extra?'}
                message={extra?.on ? `"${cat.features[extra.key]?.label}" is not in ${NAMES[plan.id]}. The shop gets it as an extra until you remove it or change the plan.` : 'The shop loses this feature again.'}
                confirmLabel={extra?.on ? 'Turn on' : 'Turn off'}
                onConfirm={() => run(() => setShopPlanExtra(shopId, extra.key, extra.on), extra.on ? 'Extra turned on' : 'Extra removed')}
            />
        </Screen>
    );
}
