import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, Badge, Chip, Button } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ConfirmSheet, toast } from '../../components/feedback';
import { fetchPlanCatalog, fetchShopPlan, setShopPlan, setShopPlanExtra, setShopPlanTerms, fetchShopWallet, adjustShopWallet, endShopFreePeriod } from '../../api/shopsApi';
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
    const [endFree, setEndFree] = useState(false);   // the "End the free period now" confirm

    const load = useCallback(async () => {
        try { const [c, p, wl] = await Promise.all([fetchPlanCatalog(), fetchShopPlan(shopId), fetchShopWallet(shopId).catch(() => null)]); setCat(c); setPlan(p); setWallet(wl?.partner ? wl : null); setDays(''); } catch (e) { toast(errMsg(e), 'error'); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

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

            {plan.id && plan.status === 'free' ? <Button title="End the free period now" kind="dangerSoft" icon="bolt" small onPress={() => setEndFree(true)} style={{ marginTop: spacing.sm }} /> : null}

            <SectionTitle section="settings">Change plan</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {cat.ids.map((id) => <Chip key={id} label={NAMES[id]} active={(look || plan.id) === id} onPress={() => setLook(plan.id === id ? null : id)} />)}
                </View>
                <Text style={{ color: t.muted, marginTop: spacing.md }}>{plan.id ? priceText(cat, plan.id) : 'Pick a plan to start.'}</Text>
                <Field label="Free days for the new plan (empty = platform default)" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
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
