import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, ListRow, Card } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import { billingStatus, unpauseShop } from '../../api/moneyApi';
import { useShopStore } from '../../store/useShopStore';
import { errMsg } from '../../api/adminClient';
import { rupees } from '../../utils/format';

// Old rent bills of one shop. Monthly rent, price tiers, go live and late fees were replaced by plans (see the shop's Plan screen and More > Plan defaults).
// This screen only helps settle bills that were issued before: what is still owed, unpause a shop that was paused for an old bill, the invoice list, and a custom invoice.
const STATE = {
    free: { label: 'No old bill', section: 'people', hint: 'Nothing from the old rent billing is open.' },
    active: { label: 'No old bill', section: 'money', hint: 'Nothing from the old rent billing is open.' },
    grace: { label: 'An old bill is unpaid', section: 'catalog', hint: 'Pay it, waive it or void it from the invoice list.' },
    paused: { label: 'Paused for an old unpaid bill', section: 'alerts', hint: 'Customers cannot order until the bill is paid, waived, or you unpause the shop.' },
};

export default function ShopBillingScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [st, setSt] = useState(null);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);
    const [days, setDays] = useState('3');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [s] = await Promise.all([billingStatus(shopId), useShopStore.getState().load(shopId, { quiet: true })]);
            setSt(s); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

    if (!st) return <Screen title="Old rent bills" subtitle={name}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const meta = STATE[st.state] || STATE.active;

    const unpause = async () => {
        setBusy(true);
        try { await unpauseShop(shopId, Math.max(1, Math.min(30, Number(days) || 3))); toast('Shop unpaused'); setSheet(null); await load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Old rent bills" subtitle={name} refreshing={false} onRefresh={load}>
            <Hero section={meta.section} title={meta.label} subtitle={meta.hint}>
                {st.due?.amount ? <Text style={{ color: t.danger, fontWeight: '800', marginTop: spacing.md }}>{rupees(st.due.amount)} unpaid</Text> : null}
            </Hero>

            {st.paused ? <Button title="Unpause this shop" icon="ok" kind="primary" style={{ marginTop: spacing.lg }} onPress={() => { setDays('3'); setSheet('unpause'); }} /> : null}

            <Card style={{ marginTop: spacing.lg }}>
                <Text style={{ color: t.muted }}>Monthly rent, price tiers, go live and late fees were replaced by plans. Choose the shop's plan, free days and extras on its Plan screen.</Text>
                <Button title="Open the Plan screen" kind="soft" icon="star" style={{ marginTop: spacing.md }} onPress={() => nav.navigate('ShopPlan', { shopId, name })} />
            </Card>

            <Card padded={false} style={{ marginTop: spacing.lg, paddingHorizontal: 16 }}>
                <ListRow section="money" icon="receipt" title="Rent invoices" subtitle="All old invoices of this shop: pay, waive, void, PDF" onPress={() => nav.navigate('Invoices', { shopId, name })} />
                <ListRow section="catalog" icon="addCircle" title="Create a custom invoice" subtitle="For a charge outside the plans" onPress={() => nav.navigate('CustomInvoice', { shopId, name })} last />
            </Card>

            <Sheet visible={sheet === 'unpause'} onClose={() => setSheet(null)} title="Unpause this shop">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>The shop takes orders again. The old bill stays open; give some days to settle it.</Text>
                <Field label="Days of grace" value={days} onChangeText={(v) => setDays(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
                <Button title="Unpause" loading={busy} onPress={unpause} style={{ marginTop: spacing.md }} />
            </Sheet>
        </Screen>
    );
}
