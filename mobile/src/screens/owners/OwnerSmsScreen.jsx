// SMS wallet: the balance, a top-up by UPI (pick a pack or type an amount), and what the balance was spent on.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, Pill, SectionTitle, Field } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import { fetchSmsWallet, fetchSmsTransactions, fetchTopupOptions } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees, toPaise, ago } from '../../utils/owners/riderRules';
import { smsLine } from '../../utils/owners/moneyRules';
import { showToast } from '../../components/customers/shop';
import { downloadAndOpen } from '../../utils/owners/files';
import { topupInvoicePdfPath } from '../../api/owners/shopApi';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';

export default function OwnerSmsScreen() {
    const nav = useNavigation();
    const { background, text, muted, error, ok, primary } = useBrand();
    const [wallet, setWallet] = useState(null);
    const [opts, setOpts] = useState(null);
    const [amount, setAmount] = useState('');
    const [type, setType] = useState('');
    const [rows, setRows] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);

    const loadRows = useCallback(async (p = 1, t = type) => {
        try {
            const r = await fetchSmsTransactions({ page: p, limit: 20, ...(t ? { type: t } : {}) });
            setRows((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p);
        } catch (e) { useOwnerStore.getState().noteError(e); setRows((x) => x || []); }
    }, [type]);

    const loadWallet = useCallback(() => fetchSmsWallet().then(setWallet).catch(() => { }), []);
    useFocusEffect(useCallback(() => { loadWallet(); loadRows(1); }, [loadWallet]));   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { fetchTopupOptions().then(setOpts).catch(() => { }); }, []);
    useEffect(() => { setRows(null); loadRows(1, type); }, [type]);   // eslint-disable-line react-hooks/exhaustive-deps

    const openInvoice = async (id) => {
        try { await downloadAndOpen({ path: topupInvoicePdfPath(id), filename: `sms-invoice-${id}.pdf`, mime: 'application/pdf', title: 'SMS top-up invoice' }); }
        catch (e) { showToast(e.safe ? e.message : (e?.response?.status === 409 ? 'The invoice is not ready yet' : 'Could not open the invoice')); }
    };
    const paise = toPaise(amount);
    const bad = paise && opts && (paise < opts.minPaise || paise > opts.maxPaise);
    // GST is added on top of what he types; he pays the total
    const gstPercent = opts?.gstPercent ?? 0;
    const gstPaise = paise ? Math.round((paise * gstPercent) / 100) : 0;
    const payablePaise = (paise || 0) + gstPaise;

    // the payment options page: any UPI app, a card, or a QR code
    const pay = () => { if (paise && !bad) nav.navigate('OwnerPay', { kind: 'sms', amountPaise: paise, payablePaise, gstPaise, gstPercent, title: 'SMS balance' }); };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="SMS balance" />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
                <Card tone={wallet?.low ? error : undefined}>
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>Balance</Text>
                    <Text style={{ color: wallet?.low ? error : text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{wallet ? rupees(wallet.balancePaise) : '—'}</Text>
                    {wallet ? (
                        <Text style={{ color: muted, marginTop: 4 }}>
                            About {Math.floor(wallet.balancePaise / Math.max(1, wallet.ratePerSmsPaise))} messages · {rupees(wallet.ratePerSmsPaise)} each
                        </Text>
                    ) : null}
                    {wallet?.zero ? <View style={{ marginTop: 8 }}><Pill label="Finished: SMS alerts have stopped" color={error} /></View> : wallet?.low ? <View style={{ marginTop: 8 }}><Pill label="Running low" color={error} /></View> : null}
                </Card>

                <SectionTitle title="Add money" />
                <Card>
                    {opts ? (
                        <Chips options={opts.packs.map((p) => [String(p / 100), rupees(p)])} value={amount} onChange={setAmount} style={{ marginTop: 0 }} />
                    ) : <LineShimmer width="100%" height={44} />}
                    <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 8))} placeholder={opts ? `Or type an amount in ₹ (minimum ${rupees(opts.minPaise)})` : 'Or type an amount in ₹'} keyboardType="decimal-pad" maxLength={8} />
                    {bad ? <Text style={{ color: error, marginTop: 6, fontSize: 12 }}>Amount must be from {rupees(opts.minPaise)} to {rupees(opts.maxPaise)}.</Text> : null}
                    {paise && !bad && gstPercent ? (
                        <View style={{ marginTop: 10, padding: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.08) }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>You pay {rupees(payablePaise)}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{rupees(paise)} goes to your SMS balance + {gstPercent}% GST {rupees(gstPaise)}</Text>
                        </View>
                    ) : opts ? <Text style={{ color: muted, marginTop: 6, fontSize: 12 }}>Minimum {rupees(opts.minPaise)}. {gstPercent ? `${gstPercent}% GST is added on top.` : ''}</Text> : null}
                    <View style={{ marginTop: 12 }}>
                        <Button label={paise && !bad ? `Pay ${rupees(payablePaise)}` : 'Choose an amount'} icon="card" disabled={!paise || !!bad} onPress={pay} />
                    </View>
                </Card>

                <SectionTitle title="History" />
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['', 'All'], ['topup', 'Top-ups'], ['debit', 'Used']]} value={type} onChange={setType} style={{ marginTop: 0 }} />
                </View>
                <Card>
                    {rows === null ? <ListShimmer count={2} rows /> : null}
                    {rows && !rows.length ? <Text style={{ color: muted }}>Nothing yet.</Text> : null}
                    {(rows || []).map((t, i) => (
                        <MoneyRow
                            key={String(t._id || t.id || i)}
                            title={smsLine(t)}
                            note={`${ago(t.createdAt)} · balance ${rupees(t.balanceAfter)}`}
                            value={`${t.type === 'debit' ? '−' : '+'}${rupees(Math.abs(t.amountPaise))}`}
                            color={t.type === 'debit' ? text : ok}
                            last={i === rows.length - 1}
                            action={t.type === 'topup' && t.topupId ? 'Open invoice (PDF)' : undefined}
                            onAction={() => openInvoice(t.topupId)}
                        />
                    ))}
                    {more ? <View style={{ marginTop: 8 }}><Button label="Show more" kind="ghost" onPress={() => loadRows(page + 1)} /></View> : null}
                </Card>
            </ScrollView>
        </View>
    );
}
