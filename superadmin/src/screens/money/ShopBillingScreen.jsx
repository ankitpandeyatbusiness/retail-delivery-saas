import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, Badge, ListRow, Chip, Stat } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { NumberField, Switch, Hint } from '../../components/settingsForm';
import { DateField } from '../../components/catalogBits';
import TiersEditor, { tiersProblem } from '../../components/tiersEditor';
import { ErrorBox, Sheet, SheetScroll, ConfirmSheet, toast } from '../../components/feedback';
import { billingStatus, billingPreview, saveShopBilling, goLive, endFreePeriod, unpauseShop, waiveAllLateFees } from '../../api/moneyApi';
import { useShopStore } from '../../store/useShopStore';
import { errMsg } from '../../api/adminClient';
import { rupees, dateOnly, ymdOf, isoOfYmd, titleCase } from '../../utils/format';

const STATE = {
    free: { label: 'Free service', tone: 'info', section: 'people', hint: 'The shop is not charged yet.' },
    active: { label: 'Paying', tone: 'success', section: 'money', hint: 'Free service is over. Monthly rent applies.' },
    grace: { label: 'Bill unpaid (grace)', tone: 'warn', section: 'catalog', hint: 'A bill is unpaid. The shop pauses when the grace period ends.' },
    paused: { label: 'Paused: unpaid bill', tone: 'danger', section: 'alerts', hint: 'Customers cannot order until the bill is paid, waived or given more time.' },
};
const lastMonths = () => {
    const out = [];
    const d = new Date(Date.now() + 330 * 60000);
    d.setUTCDate(1);
    for (let i = 0; i < 4; i += 1) { out.push(d.toISOString().slice(0, 7)); d.setUTCMonth(d.getUTCMonth() - 1); }
    return out;
};

// One shop's rent: where it stands, go-live, a preview of a bill, its own pricing, and the actions around it.
export default function ShopBillingScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const [st, setSt] = useState(null);
    const [error, setError] = useState('');
    const [prev, setPrev] = useState(null);
    const [period, setPeriod] = useState(lastMonths()[0]);
    const [sheet, setSheet] = useState(null);       // rules | unpause
    const [confirm, setConfirm] = useState(null);   // live | restart
    const [days, setDays] = useState(3);
    const [rules, setRules] = useState(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try {
            const [s] = await Promise.all([billingStatus(shopId), useShopStore.getState().load(shopId, { quiet: true })]);
            setSt(s); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        let alive = true;
        setPrev(null);
        billingPreview(shopId, period).then((r) => alive && setPrev(r)).catch(() => alive && setPrev({ error: true }));
        return () => { alive = false; };
    }, [shopId, period, st?.state]);

    const b = rec?.tenant?.billing || {};
    if (!st) return <Screen title="Billing" subtitle={name}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const meta = STATE[st.state] || STATE.free;
    const live = !!b.isLive;
    const run = async (key, fn, ok) => {
        setBusy(key);
        try { await fn(); toast(ok); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(''); }
    };

    const openRules = () => {
        setRules({
            freeOrders: b.freeOrdersOverride ?? undefined,
            freeMonths: b.freeMonthsOverride ?? undefined,
            fixedFee: b.fixedFeeOverride ?? undefined,
            ownTiers: !!(b.tiersOverride && b.tiersOverride.length),
            tiers: (b.tiersOverride && b.tiersOverride.length ? b.tiersOverride : [{ upTo: 305, fee: 3000 }, { upTo: null, fee: 6000 }]).map((x) => ({ upTo: x.upTo, fee: x.fee })),
            goLive: ymdOf(b.goLiveAt),
        });
        setSheet('rules');
    };

    const saveRules = async () => {
        if (rules.ownTiers) {
            const p = tiersProblem(rules.tiers);
            if (p) { toast(p, 'error'); return; }
        }
        const body = {
            freeOrdersOverride: rules.freeOrders ?? null,
            freeMonthsOverride: rules.freeMonths ?? null,
            fixedFeeOverride: rules.fixedFee ?? null,
            tiersOverride: rules.ownTiers ? rules.tiers : null,
            goLiveAt: rules.goLive ? isoOfYmd(rules.goLive) : null,
        };
        try { await run('rules', () => saveShopBilling(shopId, body), 'Saved'); setSheet(null); } catch (e) { /* shown */ }
    };

    return (
        <Screen title="Billing" subtitle={name} refreshing={false} onRefresh={load}>
            <Hero section={meta.section} title={meta.label} subtitle={meta.hint} right={<Badge label={live ? 'Live' : 'Not live yet'} tone={live ? 'success' : 'neutral'} />}>
                {st.due?.amount ? (
                    <Text style={{ color: t.danger, fontWeight: '800', marginTop: spacing.md }}>
                        {rupees(st.due.amount)} unpaid{st.graceDaysLeft != null ? ` · ${st.graceDaysLeft} day${st.graceDaysLeft === 1 ? '' : 's'} of grace left` : ''}
                    </Text>
                ) : null}
            </Hero>

            {st.paused ? (
                <Button title="Unpause this shop" icon="ok" kind="primary" style={{ marginTop: spacing.lg }} onPress={() => { setDays(3); setSheet('unpause'); }} />
            ) : null}

            <SectionTitle section="orders">Go live</SectionTitle>
            <Card>
                {!live ? (
                    <>
                        <Text style={{ color: t.text, fontWeight: '700' }}>Not live yet</Text>
                        <Text style={{ color: t.muted, marginTop: 4 }}>Until you press Go live the shop is free and no order is counted. Test orders cost nothing.</Text>
                        <Button title="Go live now" icon="bolt" style={{ marginTop: spacing.lg }} onPress={() => setConfirm('live')} />
                    </>
                ) : (
                    <>
                        <KeyValue label="Went live" value={b.goLiveAt ? dateOnly(b.goLiveAt) : 'Since it was created'} />
                        <KeyValue label="Orders that earned money" value={String(b.billableCount || 0)} last />
                        <Button title="Start the free period again" kind="dangerSoft" small style={{ marginTop: spacing.lg }} onPress={() => setConfirm('restart')} />
                    </>
                )}
            </Card>
            {st.free?.active ? (
                <Card>
                    <Text style={{ color: t.text, fontWeight: '700' }}>Free period is running</Text>
                    <Text style={{ color: t.muted, marginTop: 4 }}>End it now to start billing. The month it ends in is not billed; rent starts with the next full month.</Text>
                    <Button title="End the free period now" icon="bolt" kind="dangerSoft" style={{ marginTop: spacing.lg }} onPress={() => setConfirm('endfree')} />
                </Card>
            ) : null}

            <SectionTitle section="money">This month</SectionTitle>
            <View style={{ flexDirection: 'row', gap: spacing.md }}>
                <Stat section="orders" label="Orders counted" value={st.thisMonth?.billableOrders ?? 0} icon="orders" />
                <Stat section="money" label="Rent so far" value={rupees(st.thisMonth?.fee)} icon="rupee" />
            </View>
            <Card style={{ marginTop: spacing.md, paddingVertical: 0 }}>
                <KeyValue label="Price band" value={st.thisMonth?.tierLabel} />
                <KeyValue label="Free orders left" value={st.free?.active ? `${st.free.ordersLeft} of ${st.free.freeOrders}` : 'Free service is over'} />
                <KeyValue label="Free service ends" value={st.free?.active && st.free.endsAt ? dateOnly(st.free.endsAt) : st.free?.active ? 'After go-live' : '—'} last />
            </Card>

            <SectionTitle section="catalog">Preview a bill</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {lastMonths().map((m) => <View key={m} style={{ marginBottom: spacing.sm }}><Chip label={m} active={period === m} onPress={() => setPeriod(m)} /></View>)}
                </View>
                {!prev ? <Text style={{ color: t.muted }}>Working it out…</Text> : prev.error ? <Text style={{ color: t.danger }}>Could not work it out.</Text> : (
                    <>
                        <KeyValue label="Orders counted" value={String(prev.orderCount)} />
                        <KeyValue label="Price band" value={prev.tierLabel} />
                        <KeyValue label="Fee" value={rupees(prev.fee)} />
                        <KeyValue label={`GST ${prev.gstPercent}%`} value={rupees(prev.gstAmount)} />
                        <KeyValue label="Total" value={rupees(prev.total)} last />
                        <View style={{ marginTop: spacing.sm }}>
                            <Badge label={prev.billable ? (prev.finished ? 'Will be billed' : 'Billed after the month ends') : (prev.reason || 'Not billed')} tone={prev.billable ? 'success' : 'neutral'} />
                        </View>
                    </>
                )}
            </Card>

            <SectionTitle section="settings">This shop's own pricing</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow
                    section="settings"
                    icon="tune"
                    title="Free limits and fees"
                    subtitle={[
                        b.freeOrdersOverride != null ? `${b.freeOrdersOverride} free orders` : null,
                        b.freeMonthsOverride != null ? `${b.freeMonthsOverride} free months` : null,
                        b.fixedFeeOverride != null ? `Fixed ${rupees(b.fixedFeeOverride)}` : null,
                        b.tiersOverride?.length ? 'Own tiers' : null,
                    ].filter(Boolean).join(' · ') || 'Using the platform rules'}
                    onPress={openRules}
                />
                <ListRow section="money" icon="receipt" title="Rent invoices" subtitle="All invoices of this shop" onPress={() => nav.navigate('Invoices', { shopId, name })} />
                {st?.lateFees?.count > 0 ? (
                    <ListRow section="alerts" icon="ok" title="Waive all late fees" subtitle={`${st.lateFees.count} unpaid · ${rupees(st.lateFees.amount)}. The rent bills stay unpaid.`} onPress={() => setConfirm('waivefees')} />
                ) : null}
                <ListRow section="catalog" icon="addCircle" title="Create a custom invoice" subtitle="For something outside the monthly rent" onPress={() => nav.navigate('CustomInvoice', { shopId, name })} last />
            </Card>

            <ConfirmSheet
                visible={confirm === 'waivefees'}
                onClose={() => setConfirm(null)}
                title="Waive all late fees?"
                message="Every unpaid late fee of this shop is cancelled, each with a credit note. The unpaid rent bills stay. While a bill stays unpaid, a new late fee can still be added later."
                confirmLabel="Waive all"
                needReason
                onConfirm={(r) => run('waivefees', () => waiveAllLateFees(shopId, r), 'Late fees waived')}
            />
            <ConfirmSheet
                visible={confirm === 'live'}
                onClose={() => setConfirm(null)}
                title="Start billing this shop?"
                message="The free period (free orders and free months) starts NOW and the order counter starts at 0. Do this when the shop opens for real business."
                confirmLabel="Go live"
                onConfirm={() => run('live', () => goLive(shopId, false), 'The shop is live')}
            />
            <ConfirmSheet
                visible={confirm === 'endfree'}
                onClose={() => setConfirm(null)}
                title="End the free period now?"
                message="Free orders and free months stop counting at this moment, whatever is left. Raising the limits later does not bring it back; use Start the free period again for that."
                confirmLabel="End it"
                danger
                onConfirm={() => run('endfree', () => endFreePeriod(shopId), 'The free period has ended')}
            />
            <ConfirmSheet
                visible={confirm === 'restart'}
                onClose={() => setConfirm(null)}
                title="Start the free period again?"
                message="The order counter goes back to 0 and the free period starts now. An unpaid bill stays in force. Use this only to correct a mistake."
                confirmLabel="Restart"
                danger
                onConfirm={() => run('restart', () => goLive(shopId, true), 'Free period restarted')}
            />

            <Sheet visible={sheet === 'unpause'} onClose={() => setSheet(null)} title="Unpause this shop">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>Every overdue unpaid bill gets a new grace period, so the shop can take orders again while it pays.</Text>
                <NumberField label="Grace days" integer value={days} onChange={(v) => setDays(v ?? 1)} hint="1 to 60" />
                <Button title="Unpause" loading={busy === 'unpause'} onPress={async () => { try { await run('unpause', () => unpauseShop(shopId, Math.max(1, Math.min(60, days || 1))), 'The shop can take orders again'); setSheet(null); } catch (e) { /* shown */ } }} />
            </Sheet>

            <Sheet visible={sheet === 'rules'} onClose={() => setSheet(null)} title="This shop's own pricing">
                {rules ? (
                    <SheetScroll style={{ maxHeight: 460 }} keyboardShouldPersistTaps="handled">
                        <Hint>Leave a box empty to use the platform rule.</Hint>
                        <View style={{ height: spacing.md }} />
                        <NumberField label="Free orders" integer value={rules.freeOrders} onChange={(v) => setRules({ ...rules, freeOrders: v })} />
                        <NumberField label="Free months" integer value={rules.freeMonths} onChange={(v) => setRules({ ...rules, freeMonths: v })} />
                        <NumberField label="Fixed monthly fee (instead of tiers)" prefix="₹" value={rules.fixedFee} onChange={(v) => setRules({ ...rules, fixedFee: v })} />
                        <DateField label="Go-live date (optional)" hint="Free service counts from this day" value={rules.goLive} onChange={(v) => setRules({ ...rules, goLive: v })} />
                        <Switch title="Use own price tiers" subtitle="Instead of the platform tiers" value={rules.ownTiers} onValueChange={(v) => setRules({ ...rules, ownTiers: v })} last />
                        {rules.ownTiers ? <View style={{ marginTop: spacing.md }}><TiersEditor value={rules.tiers} onChange={(v) => setRules({ ...rules, tiers: v })} /></View> : null}
                    </SheetScroll>
                ) : null}
                <Button title="Save" loading={busy === 'rules'} onPress={saveRules} style={{ marginTop: spacing.md }} />
                <Button title="Use the platform rules for everything" kind="outline" small style={{ marginTop: spacing.sm }} onPress={async () => { try { await run('rules', () => saveShopBilling(shopId, { reset: true }), 'Back to the platform rules'); setSheet(null); } catch (e) { /* shown */ } }} />
            </Sheet>
        </Screen>
    );
}
