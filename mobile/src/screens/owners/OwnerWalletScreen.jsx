// The Partner plan's wallet: the balance, a top-up (pick a pack or type an amount), and every fee taken ("Order #1042, Rs 420, fee Rs 9").
// The fee table is never shown here: the owner reads only "Rs 3 to Rs 15 per order, depending on the order value".
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, Pill, SectionTitle, Field } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import { fetchWallet, fetchWalletHistory, walletInvoicePdfPath } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { downloadAndOpen } from '../../utils/owners/files';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees, toPaise, ago } from '../../utils/owners/riderRules';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const lineOf = (t) => {
    if (t.type === 'fee') return t.orderNo ? tr('Order #{no}, {rupees}, fee {fee}', { no: t.orderNo, rupees: rupees(Math.round((t.baseRs || 0) * 100)), fee: rupees(-t.amountPaise) }) : tr('Order fee');
    if (t.type === 'reverse') return tr('Order #{no} put back, fee returned', { no: t.orderNo || '' });
    if (t.type === 'topup') return tr('Top-up');
    return t.note || tr('Adjustment');
};

export default function OwnerWalletScreen() {
    const nav = useNavigation();
    const { background, text, muted, error, ok, primary } = useBrand();
    const [w, setW] = useState(null);
    const [h, setH] = useState(null);
    const [amount, setAmount] = useState('');

    const load = useCallback(async () => {
        try { const [a, b] = await Promise.all([fetchWallet(), fetchWalletHistory()]); setW(a); setH(b); } catch (e) { useOwnerStore.getState().noteError(e); setH((x) => x || { items: [] }); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const openInvoice = async (id) => {
        try { await downloadAndOpen({ path: walletInvoicePdfPath(id), filename: `wallet-invoice-${id}.pdf`, mime: 'application/pdf', title: tr('Wallet top-up invoice') }); }
        catch (e) { showToast(e?.response?.status === 409 ? tr('The invoice is not ready yet') : tr('Could not open the invoice')); }
    };

    const paise = toPaise(amount);
    const bad = paise && w && (paise < w.minPaise || paise > w.maxPaise);
    const gstPercent = w?.gstPercent ?? 0;
    const gstPaise = paise ? Math.round((paise * gstPercent) / 100) : 0;
    const payablePaise = (paise || 0) + gstPaise;
    const pay = () => { if (paise && !bad) nav.navigate('OwnerPay', { kind: 'wallet', amountPaise: paise, payablePaise, gstPaise, gstPercent, title: tr('Wallet') }); };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Wallet')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
                <Card tone={w && (w.zero || w.low) ? error : undefined}>
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('Balance')}</Text>
                    <Text style={{ color: w && w.balancePaise < 0 ? error : text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{w ? rupees(w.balancePaise) : '—'}</Text>
                    {w ? <Text style={{ color: muted, marginTop: 4 }}>{tr('Each completed order costs Rs {min} to Rs {max}, depending on the order value.', { min: w.feeRange.minRs, max: w.feeRange.maxRs })}</Text> : null}
                    {w?.zero ? <View style={{ marginTop: 8 }}><Pill label={w.canTakeOrders ? tr('Balance finished. Add money soon') : tr('Finished: new orders have stopped')} color={error} /></View> : w?.low ? <View style={{ marginTop: 8 }}><Pill label={tr('Running low')} color={error} /></View> : null}
                    {h?.feesThisMonth ? <Text style={{ color: muted, marginTop: 8, fontSize: 12 }}>{tr('Fees this month: {rupees} for {n} orders', { rupees: rupees(h.feesThisMonth.paise), n: h.feesThisMonth.orders })}</Text> : null}
                </Card>

                <SectionTitle title={tr('Add money')} />
                <Card>
                    {w ? <Chips options={w.packs.map((p) => [String(p / 100), rupees(p)])} value={amount} onChange={setAmount} style={{ marginTop: 0 }} /> : <LineShimmer width="100%" height={44} />}
                    <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 8))} placeholder={w ? tr('Or type an amount in ₹ (minimum {rupees})', { rupees: rupees(w.minPaise) }) : ''} keyboardType="decimal-pad" />
                    {bad ? <Text style={{ color: error, marginTop: 6, fontSize: 12 }}>{tr('Amount must be from {rupees} to {rupees2}.', { rupees: rupees(w.minPaise), rupees2: rupees(w.maxPaise) })}</Text> : null}
                    {paise && !bad && gstPercent ? (
                        <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.08) }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('You pay {rupees}', { rupees: rupees(payablePaise) })}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('{rupees} goes to your wallet + {gstPercent}% GST {rupees3}', { rupees: rupees(paise), gstPercent, rupees3: rupees(gstPaise) })}</Text>
                        </View>
                    ) : null}
                    <View style={{ marginTop: 12 }}>
                        <Button label={paise && !bad ? tr('Pay {rupees}', { rupees: rupees(payablePaise) }) : tr('Choose an amount')} icon="card" disabled={!paise || !!bad} onPress={pay} />
                    </View>
                </Card>

                <SectionTitle title={tr('History')} />
                <Card>
                    {h === null ? <ListShimmer count={2} rows /> : null}
                    {h && !h.items.length ? <Text style={{ color: muted }}>{tr('Nothing yet.')}</Text> : null}
                    {(h?.items || []).map((t, i) => (
                        <MoneyRow
                            key={t.id}
                            title={lineOf(t)}
                            note={tr('{ago} · balance {rupees}', { ago: ago(t.at), rupees: rupees(t.balanceAfter) })}
                            value={`${t.amountPaise < 0 ? '−' : '+'}${rupees(Math.abs(t.amountPaise))}`}
                            color={t.amountPaise < 0 ? text : ok}
                            last={i === h.items.length - 1}
                            action={t.topupId ? tr('Open invoice (PDF)') : undefined}
                            onAction={() => openInvoice(t.topupId)}
                        />
                    ))}
                </Card>
            </ScrollView>
        </View>
    );
}
