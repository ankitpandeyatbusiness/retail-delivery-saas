import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, Badge, Chip } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ConfirmSheet, toast } from '../../components/feedback';
import { fetchPlanCatalog, fetchShopPlan, setShopPlan, setShopPlanExtra, setShopPlanTerms } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { planLine } from '../../components/shopBits';
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
    const [extra, setExtra] = useState(null);      // { key, on } waiting for confirmation
    const [days, setDays] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { const [c, p] = await Promise.all([fetchPlanCatalog(), fetchShopPlan(shopId)]); setCat(c); setPlan(p); setDays(''); } catch (e) { toast(errMsg(e), 'error'); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

    if (!cat || !plan) return <Screen title="Plan" subtitle={tenant?.name}><SkeletonList count={4} /></Screen>;

    const run = async (fn, ok) => {
        setBusy(true);
        try { const r = await fn(); setPlan(r); toast(ok); useShopStore.getState().load(shopId, { quiet: true }); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(false); }
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

            <SectionTitle section="settings">Change plan</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {cat.ids.map((id) => <Chip key={id} label={NAMES[id]} active={plan.id === id} onPress={() => plan.id !== id && setPick(id)} />)}
                </View>
                <Text style={{ color: t.muted, marginTop: spacing.md }}>{plan.id ? priceText(cat, plan.id) : 'Pick a plan to start.'}</Text>
                <Field label="Free days for the new plan (empty = platform default)" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={3} />
            </Card>

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
                        <Text style={{ color: t.muted, marginTop: spacing.sm }}>These only take effect once the website is built and the switches are wired in the last plan phase.</Text>
                    </Card>
                </>
            ) : null}

            <ConfirmSheet
                visible={!!pick}
                onClose={() => setPick(null)}
                title={`Switch to ${NAMES[pick] || ''}?`}
                message={switchMsg}
                confirmLabel="Switch plan"
                onConfirm={() => run(() => setShopPlan(shopId, { to: pick, ...(days !== '' ? { freeDays: Number(days) } : {}) }), `Now on ${NAMES[pick]}`)}
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
