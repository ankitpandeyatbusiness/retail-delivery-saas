import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Chip } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { toast } from '../../components/feedback';
import { fetchPlanCatalog, savePlanDefaults } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

const digits = (v) => String(v ?? '').replace(/\D/g, '');
const rs = (paise) => String(Math.round((paise || 0) / 100));

// Platform defaults for the plans: prices, Partner fee slabs, free and grace days, GST, branch add-on, multi-month discounts.
// Only the supreme admin can save (the server refuses everyone else). A shop can still have its own amount or free days on its Plan screen.
export default function PlanDefaultsScreen() {
    const t = useTheme();
    const [f, setF] = useState(null);
    const [busy, setBusy] = useState(false);
    const [feat, setFeat] = useState(null);   // what each plan includes: { key: { label, plans[], editable } }

    useEffect(() => {
        fetchPlanCatalog().then((c) => {
            const d = c.defaults;
            setF({
                growth: rs(d.growth.pricePaise), pro: rs(d.pro.pricePaise), freeDays: String(d.freeDays), graceDays: String(d.graceDays), gst: String(d.gstPercent),
                branches: String(d.includedBranches), addon: rs(d.branchAddonPaise),
                disc: [1, 2, 3, 4, 5, 6].map((m) => String(d.monthDiscounts[m] ?? 0)),
                slabs: d.feeSlabs.map((s) => ({ upTo: s.upTo === null ? '' : String(s.upTo), fee: String(s.feeRs) })),
            });
            setFeat(Object.fromEntries(Object.entries(c.features).filter(([, x]) => x.editable).map(([k, x]) => [k, { label: x.label, plans: x.plans }])));
        }).catch((e) => toast(errMsg(e), 'error'));
    }, []);

    if (!f) return <Screen title="Plan defaults"><SkeletonList count={4} /></Screen>;
    const set = (k) => (v) => setF({ ...f, [k]: digits(v) });
    const setSlab = (i, k, v) => setF({ ...f, slabs: f.slabs.map((s, j) => (j === i ? { ...s, [k]: digits(v) } : s)) });
    const toggleFeat = (k, id) => setFeat({ ...feat, [k]: { ...feat[k], plans: feat[k].plans.includes(id) ? feat[k].plans.filter((p) => p !== id) : [...feat[k].plans, id] } });
    const setDisc = (i, v) => setF({ ...f, disc: f.disc.map((x, j) => (j === i ? digits(v) : x)) });

    const save = async () => {
        setBusy(true);
        try {
            const last = f.slabs.length - 1;
            await savePlanDefaults({
                growth: { pricePaise: Number(f.growth) * 100 }, pro: { pricePaise: Number(f.pro) * 100 },
                freeDays: Number(f.freeDays), graceDays: Number(f.graceDays), gstPercent: Number(f.gst),
                includedBranches: Number(f.branches), branchAddonPaise: Number(f.addon) * 100,
                monthDiscounts: Object.fromEntries(f.disc.map((v, i) => [i + 1, Number(v)])),
                feeSlabs: f.slabs.map((s, i) => ({ upTo: i === last ? null : Number(s.upTo), feeRs: Number(s.fee) })),
                features: Object.fromEntries(Object.entries(feat || {}).map(([k, x]) => [k, x.plans])),
            });
            toast('Plan defaults saved');
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Plan defaults" subtitle="Prices and rules for every shop. Only the supreme admin can save.">
            <SectionTitle section="money">Prices (Rs, before GST, per 30 days)</SectionTitle>
            <Card>
                <Field label="Growth" value={f.growth} onChangeText={set('growth')} keyboardType="number-pad" maxLength={6} />
                <Field label="Pro" value={f.pro} onChangeText={set('pro')} keyboardType="number-pad" maxLength={6} />
                <Field label="GST %" value={f.gst} onChangeText={set('gst')} keyboardType="number-pad" maxLength={2} />
            </Card>

            <SectionTitle section="settings">Free period and grace</SectionTitle>
            <Card>
                <Field label="Free days for a new plan" value={f.freeDays} onChangeText={set('freeDays')} keyboardType="number-pad" maxLength={3} />
                <Field label="Grace days after a plan ends" value={f.graceDays} onChangeText={set('graceDays')} keyboardType="number-pad" maxLength={2} />
            </Card>

            <SectionTitle section="shops">Branches (Pro)</SectionTitle>
            <Card>
                <Field label="Branches included with the main shop" value={f.branches} onChangeText={set('branches')} keyboardType="number-pad" maxLength={2} />
                <Field label="Each extra branch, Rs per month" value={f.addon} onChangeText={set('addon')} keyboardType="number-pad" maxLength={6} />
            </Card>

            <SectionTitle section="catalog">Multi-month discount (%)</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                    {f.disc.map((v, i) => (
                        <View key={i} style={{ width: '30%' }}>
                            <Field label={`${i + 1} month${i ? 's' : ''}`} value={v} onChangeText={(x) => setDisc(i, x)} keyboardType="number-pad" maxLength={2} />
                        </View>
                    ))}
                </View>
            </Card>

            <SectionTitle section="orders">Partner fee per order</SectionTitle>
            <Card>
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.sm }}>By the order value at checkout. Fee Rs 3 to Rs 15. Owners never see this table, only "Rs 3 to Rs 15 per order".</Text>
                {f.slabs.map((s, i) => (
                    <View key={i} style={{ flexDirection: 'row', gap: spacing.sm }}>
                        <View style={{ flex: 1 }}>
                            {i === f.slabs.length - 1
                                ? <Field label="Above the last amount" value="open ended" editable={false} />
                                : <Field label="Order value up to Rs" value={s.upTo} onChangeText={(v) => setSlab(i, 'upTo', v)} keyboardType="number-pad" maxLength={6} />}
                        </View>
                        <View style={{ flex: 1 }}>
                            <Field label="Fee Rs" value={s.fee} onChangeText={(v) => setSlab(i, 'fee', v)} keyboardType="number-pad" maxLength={2} />
                        </View>
                    </View>
                ))}
            </Card>

            {feat ? (
                <>
                    <SectionTitle section="catalog">What each plan includes</SectionTitle>
                    <Card>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>Tick the plans that get each feature. A change reaches every shop on those plans within seconds: owners see it in their Plan screen, side menu and locks, and the server enforces it. Kitchen and waiter logins and the rider limit stay fixed in the app. Saved with the button at the bottom.</Text>
                        {Object.entries(feat).map(([k, x], i) => (
                            <View key={k} style={{ paddingVertical: spacing.sm, borderTopWidth: i ? 1 : 0, borderTopColor: t.border }}>
                                <Text style={{ color: t.text, fontWeight: '700', marginBottom: spacing.xs }}>{x.label}</Text>
                                <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                                    {['partner', 'growth', 'pro'].map((id) => <Chip key={id} label={id[0].toUpperCase() + id.slice(1)} active={x.plans.includes(id)} onPress={() => toggleFeat(k, id)} />)}
                                </View>
                            </View>
                        ))}
                    </Card>
                </>
            ) : null}

            <Button title="Save plan defaults" onPress={save} loading={busy} style={{ marginTop: spacing.lg }} />
        </Screen>
    );
}
