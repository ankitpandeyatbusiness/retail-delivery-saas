import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, Chip, SectionTitle, KeyValue, ListRow } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { NumberField, Switch, Choice, Hint } from '../../components/settingsForm';
import { ErrorBox, Empty, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { smsWallet, smsTransactions, smsTopups, saveSmsSettings, markTopupPaid } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, toPaise, dateTime, titleCase } from '../../utils/format';

const TYPES = [{ value: '', label: 'All' }, { value: 'topup', label: 'Top-ups' }, { value: 'debit', label: 'Used' }, { value: 'refund', label: 'Refunds' }, { value: 'adjust', label: 'Adjustments' }];

// A shop's SMS wallet: balance, top-ups, manual credit and debit, its own prices, and its sender.
export default function ShopSmsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [w, setW] = useState(null);
    const [tx, setTx] = useState(null);
    const [tops, setTops] = useState([]);
    const [type, setType] = useState('');
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);       // credit | debit | prices
    const [prices, setPrices] = useState({});
    const [busy, setBusy] = useState('');
    const [paid, setPaid] = useState(null);

    const load = useCallback(async () => {
        try {
            const [a, b, c] = await Promise.all([smsWallet(shopId), smsTransactions(shopId, { limit: 20, ...(type ? { type } : {}) }), smsTopups(shopId)]);
            setW(a); setTx(b.items); setTops(c.items || []); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [shopId, type]);
    useEffect(() => { load(); }, [load]);

    if (!w) return <Screen title="SMS wallet" subtitle={name}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const savePrices = async () => {
        setBusy('prices');
        try {
            const body = {
                ratePerSmsPaise: prices.rate === undefined ? null : toPaise(prices.rate),
                costPerSmsPaise: prices.cost === undefined ? null : toPaise(prices.cost),
                lowBalancePaise: prices.low === undefined ? null : toPaise(prices.low),
                blockAtZero: !!prices.block,
            };
            await saveSmsSettings(shopId, body);
            toast('Saved'); setSheet(null); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const state = w.zero ? { label: 'Out of balance', section: 'alerts', tone: 'danger' } : w.low ? { label: 'Running low', section: 'catalog', tone: 'warn' } : { label: 'Healthy', section: 'money', tone: 'success' };

    return (
        <Screen title="SMS wallet" subtitle={name} refreshing={false} onRefresh={load}>
            <Hero section={state.section} title={rupeesFromPaise(w.balancePaise)} subtitle={`${rupeesFromPaise(w.ratePerSmsPaise)} per SMS`} right={<Badge label={state.label} tone={state.tone} />}>
                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>
                    {w.blockAtZero ? 'SMS stop when the balance runs out.' : 'SMS keep going at zero balance (free for the shop).'}
                </Text>
                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.xs }}>The owner adds credit himself, from the shop app, by paying with UPI.</Text>
            </Hero>

            {tops.length ? (
                <>
                    <SectionTitle section="orders">Top-ups</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {tops.map((p, i) => (
                            <ListRow
                                key={String(p._id || p.id)}
                                section={p.status === 'paid' ? 'money' : p.status === 'expired' ? 'platform' : 'catalog'}
                                icon={p.status === 'paid' ? 'ok' : 'clock'}
                                title={rupeesFromPaise(p.amountPaise)}
                                subtitle={`${titleCase(p.status)} · ${dateTime(p.paidAt || p.createdAt)}`}
                                right={p.status === 'pending' ? <Button title="Mark paid" small kind="soft" onPress={() => setPaid(p)} /> : null}
                                last={i === tops.length - 1}
                            />
                        ))}
                    </Card>
                </>
            ) : null}

            <SectionTitle section="settings">Prices for this shop</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow
                    section="settings"
                    icon="tune"
                    title="Price, cost and warning level"
                    subtitle="Empty values use the platform prices"
                    onPress={() => { setPrices({ rate: undefined, cost: undefined, low: undefined, block: w.blockAtZero }); setSheet('prices'); }}
                />
                <ListRow section="platform" icon="phone" title="Shop's own SMS sender" subtitle="Own DLT sender and provider keys" onPress={() => nav.navigate('SmsProvider', { shopId, name })} last />
            </Card>

            <SectionTitle section="money">History</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
                {TYPES.map((c) => <View key={c.label} style={{ marginBottom: spacing.sm }}><Chip label={c.label} active={type === c.value} onPress={() => setType(c.value)} /></View>)}
            </View>
            {tx === null ? <SkeletonList count={3} avatar={false} /> : !tx.length ? <Empty icon="message" title="No wallet movements" /> : tx.map((x, i) => (
                <Card key={i} style={{ marginBottom: spacing.sm }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flex: 1, paddingRight: spacing.md }}>
                            <Text style={{ color: t.text, fontWeight: '800' }}>{titleCase(x.type)}{x.purpose ? ` · ${titleCase(x.purpose)}` : ''}</Text>
                            <Text style={{ color: t.muted, fontSize: font.xs }}>{dateTime(x.createdAt)}{x.note ? ` · ${x.note}` : ''}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ color: x.amountPaise >= 0 ? t.success : t.danger, fontWeight: '800' }}>{x.amountPaise >= 0 ? '+' : '−'} {rupeesFromPaise(Math.abs(x.amountPaise))}</Text>
                            <Text style={{ color: t.muted, fontSize: font.xs }}>Balance {rupeesFromPaise(x.balanceAfter)}</Text>
                        </View>
                    </View>
                </Card>
            ))}


            <Sheet visible={sheet === 'prices'} onClose={() => setSheet(null)} title="Prices for this shop">
                <Hint>Leave a box empty to use the platform price.</Hint>
                <View style={{ height: spacing.md }} />
                <NumberField label="Price of one SMS" prefix="₹" value={prices.rate} onChange={(v) => setPrices({ ...prices, rate: v })} />
                <NumberField label="Cost of one SMS" prefix="₹" value={prices.cost} onChange={(v) => setPrices({ ...prices, cost: v })} />
                <NumberField label="Warn below" prefix="₹" value={prices.low} onChange={(v) => setPrices({ ...prices, low: v })} />
                <Switch title="Stop SMS at zero balance" value={!!prices.block} onValueChange={(v) => setPrices({ ...prices, block: v })} last />
                <Button title="Save" loading={busy === 'prices'} onPress={savePrices} style={{ marginTop: spacing.md }} />
            </Sheet>

            <ConfirmSheet
                visible={!!paid}
                onClose={() => setPaid(null)}
                title={`Mark ${paid ? rupeesFromPaise(paid.amountPaise) : ''} as paid?`}
                message="Use this when the owner paid but the payment did not arrive by itself. The money is added to the wallet."
                confirmLabel="Mark paid"
                onConfirm={async () => { try { await markTopupPaid(shopId, String(paid._id || paid.id)); toast('Top-up added'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } }}
            />
        </Screen>
    );
}
