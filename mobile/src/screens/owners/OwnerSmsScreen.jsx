// SMS wallet: the balance, a top-up by UPI (pick a pack or type an amount), and what the balance was spent on.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, Pill, SectionTitle, Field } from '../../components/owners/ui';
import { MoneyRow } from '../../components/owners/moneyBits';
import { fetchSmsWallet, fetchSmsTransactions, fetchTopupOptions } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { rupees, toPaise, ago } from '../../utils/owners/riderRules';
import { smsLine } from '../../utils/owners/moneyRules';
import { showToast } from '../../components/customers/shop';
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

    const paise = toPaise(amount);
    const bad = paise && opts && (paise < opts.minPaise || paise > opts.maxPaise);

    // the payment options page: any UPI app, a card, or a QR code
    const pay = () => { if (paise && !bad) nav.navigate('OwnerPay', { kind: 'sms', amountPaise: paise, title: 'SMS balance' }); };

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
                    <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 8))} placeholder="Or type an amount in ₹" keyboardType="decimal-pad" maxLength={8} />
                    {bad ? <Text style={{ color: error, marginTop: 6, fontSize: 12 }}>Amount must be from {rupees(opts.minPaise)} to {rupees(opts.maxPaise)}.</Text> : null}
                    <View style={{ marginTop: 12 }}>
                        <Button label={paise && !bad ? `Pay ${rupees(paise)}` : 'Choose an amount'} icon="card" disabled={!paise || !!bad} onPress={pay} />
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
                        />
                    ))}
                    {more ? <View style={{ marginTop: 8 }}><Button label="Show more" kind="ghost" onPress={() => loadRows(page + 1)} /></View> : null}
                </Card>
            </ScrollView>
        </View>
    );
}
