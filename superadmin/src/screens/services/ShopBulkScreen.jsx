import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, Chip, SectionTitle, KeyValue } from '../../components/ui';
import { Segmented } from '../../components/inputs';
import { Group, Switch, NumberField, Choice, Hint } from '../../components/settingsForm';
import { Hero, SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, toast } from '../../components/feedback';
import { bulkRules, saveBulkRules, listBulkOrders } from '../../api/bulkApi';
import { errMsg } from '../../api/adminClient';
import { dateTime } from '../../utils/format';

const STATUS_TONE = {
    requested: 'warn', quoted: 'info', confirmed: 'success', preparing: 'success', ready: 'success', out_for_delivery: 'success',
    delivered: 'success', completed: 'success', declined: 'danger', cancelled: 'danger', expired: 'neutral',
};
const rs = (n) => `₹${+Number(n || 0).toFixed(2)}`;
const paise = (p) => rs((p || 0) / 100);
// the same chips, in the same order, as the owner's Bulk orders list
const FILTERS = [['all', 'All'], ['open', 'Active'], ['requested', 'Needs a quote'], ['quoted', 'Quote sent'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['paid', 'Advance paid']];
const FEE_TYPES =[{ value: 'free', label: 'Free' }, { value: 'flat', label: 'Same for all' }, { value: 'free_above', label: 'Free above an amount' }, { value: 'distance', label: 'By distance' }];

// Bulk orders of one shop: the rules (the owner sets them too, when you switched Bulk orders on for him) and a read-only list of the orders with their money.
// The switch itself is in the shop's App features. You can change the rules of any shop, even one that is switched off.
export default function ShopBulkScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [tab, setTab] = useState('rules');
    const [v, setV] = useState(null);
    const [error, setError] = useState('');
    const [saving, setSaving] = useState(false);
    const [orders, setOrders] = useState(null);
    const [filter, setFilter] = useState('all');

    const load = useCallback(async () => { try { setV(await bulkRules(shopId)); setError(''); } catch (e) { setError(errMsg(e)); } }, [shopId]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        if (tab !== 'orders') return;
        setOrders(null);
        listBulkOrders(shopId, filter === 'all' ? {} : { status: filter }).then((r) => setOrders(r.items || [])).catch((e) => { setOrders([]); toast(errMsg(e), 'error'); });
    }, [tab, filter, shopId]);

    if (!v) return <Screen title="Bulk orders" subtitle={name}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const fee = v.deliveryFee || { type: 'free' };
    const set = (k) => (x) => setV((a) => ({ ...a, [k]: x }));
    const setFee = (k) => (x) => setV((a) => ({ ...a, deliveryFee: { ...a.deliveryFee, [k]: x } }));

    // fills the form with the numbers the server recommends (it does not touch the on/off switch); then Save
    const recommend = () => {
        if (!v.recommended) return;
        setV((a) => ({ ...a, ...a.recommended, deliveryFee: { ...a.deliveryFee, ...a.recommended.deliveryFee } }));
        toast('Recommended settings filled in. Tap Save.');
    };

    const save = async () => {
        const body = {
            enabled: !!v.enabled, paused: !!v.paused, pickup: !!v.pickup, delivery: !!v.delivery,
            ...Object.fromEntries(['minOrderAmount', 'noticeHours', 'maxQtyPerDish', 'packagingCharge', 'advancePercent', 'quoteValidHours', 'fullRefundHours'].filter((k) => v[k] !== undefined).map((k) => [k, v[k]])),
            deliveryFee: Object.fromEntries(['type', 'amount', 'freeAbove', 'baseKm', 'baseFee', 'perKmFee', 'maxFee'].filter((k) => fee[k] !== undefined).map((k) => [k, fee[k]])),
        };
        setSaving(true);
        try { setV(await saveBulkRules(shopId, body)); toast('Saved'); } catch (e) { toast(errMsg(e), 'error'); } finally { setSaving(false); }
    };

    return (
        <Screen title="Bulk orders" subtitle={name} refreshing={false} onRefresh={load}>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'rules', label: 'Rules' }, { value: 'orders', label: 'Orders' }]} />

            <View style={{ marginTop: spacing.lg }}>
                <Hero
                    section={v.featureOn ? 'money' : 'platform'}
                    title={v.featureOn ? 'Bulk orders are switched ON for this shop' : 'Bulk orders are switched OFF for this shop'}
                    subtitle={v.featureOn ? (v.enabled ? 'The owner takes bulk orders now' : 'The owner has bulk ordering switched off himself') : 'Switch it on in App features. The owner cannot set bulk prices or rules until then'}
                />
            </View>

            {tab === 'rules' ? (
                <>
                    <View style={{ marginTop: spacing.lg }}><Button title="Use recommended settings" icon="bolt" kind="outline" onPress={recommend} /></View>
                    <Group title="Bulk ordering" section="alerts">
                        <Switch title="Take bulk orders" subtitle="The owner can switch this off himself when he has the switch" value={!!v.enabled} onValueChange={set('enabled')} />
                        <Switch title="Pause bulk orders" subtitle="Customers still see it, marked temporarily unavailable, and cannot send a new request. Orders already taken carry on." value={!!v.paused} onValueChange={set('paused')} />
                        <Switch title="Pickup" value={!!v.pickup} onValueChange={set('pickup')} />
                        <Switch title="Delivery" value={!!v.delivery} onValueChange={set('delivery')} last />
                    </Group>
                    <Group title="Minimums" section="orders">
                        <NumberField label="Minimum order" hint="After the bulk prices. 0 = none" prefix="₹" value={v.minOrderAmount} onChange={set('minOrderAmount')} />
                        <NumberField label="Notice needed" integer suffix="hours" value={v.noticeHours} onChange={set('noticeHours')} />
                        <NumberField label="Most pieces of one dish" placeholder="e.g. 200" hint="The most pieces of one dish in a single bulk order." integer value={v.maxQtyPerDish} onChange={set('maxQtyPerDish')} last />
                    </Group>
                    <Group title="Delivery fee for bulk orders" section="orders">
                        <Choice options={FEE_TYPES} value={fee.type} onChange={setFee('type')} />
                        {fee.type === 'flat' || fee.type === 'free_above' ? <NumberField label="Delivery fee" placeholder="e.g. 100" hint="A flat delivery fee in rupees for bulk orders." prefix="₹" value={fee.amount} onChange={setFee('amount')} /> : null}
                        {fee.type === 'free_above' || fee.type === 'distance' ? <NumberField label="Free when the order is above" hint="0 = never free" prefix="₹" value={fee.freeAbove} onChange={setFee('freeAbove')} /> : null}
                        {fee.type === 'distance' ? (
                            <>
                                <NumberField label="Fee for the first km" placeholder="e.g. 100" hint="The fee in rupees that covers the first kilometres." prefix="₹" value={fee.baseFee} onChange={setFee('baseFee')} />
                                <NumberField label="First km covered by that fee" placeholder="e.g. 5" hint="How many kilometres that first fee covers." suffix="km" value={fee.baseKm} onChange={setFee('baseKm')} />
                                <NumberField label="Extra fee for every further km" placeholder="e.g. 10" hint="Rupees added for each kilometre after that." prefix="₹" value={fee.perKmFee} onChange={setFee('perKmFee')} />
                                <NumberField label="Highest fee" hint="0 = no limit" prefix="₹" value={fee.maxFee} onChange={setFee('maxFee')} />
                            </>
                        ) : null}
                        <NumberField label="Packaging charge" placeholder="e.g. 10" hint="A flat rupee charge added to each order for packaging. 0 = none." prefix="₹" value={v.packagingCharge} onChange={set('packagingCharge')} last />
                    </Group>
                    <Group title="Quote and advance" section="money">
                        <NumberField label="Advance to confirm" suffix="%" value={v.advancePercent} onChange={set('advancePercent')} />
                        <NumberField label="A quote stays valid for" integer suffix="hours" value={v.quoteValidHours} onChange={set('quoteValidHours')} />
                        <NumberField label="Full refund if cancelled before" hint="Hours before the time. Later, the shop keeps the advance. Each quote keeps the hours it was sent with" integer suffix="hours" value={v.fullRefundHours} onChange={set('fullRefundHours')} last />
                    </Group>
                    <View style={{ marginTop: spacing.lg }}><Button title="Save the rules" icon="ok" loading={saving} onPress={save} /></View>
                    <Hint>The bulk price of each dish (for example 10% off from 30 pieces) is set on the dish, in the shop's menu.</Hint>
                </>
            ) : (
                <>
                    <View style={{ height: 52, marginTop: spacing.md }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                            {FILTERS.map(([value, label]) => <Chip key={value} label={label} active={filter === value} onPress={() => setFilter(value)} />)}
                        </ScrollView>
                    </View>
                    {orders === null ? <SkeletonList count={3} avatar={false} /> : null}
                    {orders && !orders.length ? <Empty title="No bulk orders" hint="Nothing here for this filter." /> : null}
                    {(orders || []).map((o) => {
                        const total = o.quote?.pricing?.total ?? o.pricing?.total;
                        const pd = o.payment;
                        const refundPending = pd?.refundStatus === 'pending';
                        return (
                            <View key={o.id} style={{ marginTop: spacing.md }}>
                                <Card>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md }}>{o.contact?.company || o.contact?.name} · {o.code}</Text>
                                        <Badge label={String(o.status).replace(/_/g, ' ')} tone={STATUS_TONE[o.status] || 'neutral'} />
                                    </View>
                                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>{o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'} · {dateTime(o.when)}</Text>
                                    <View style={{ marginTop: spacing.sm }}>
                                        <KeyValue label="Total" value={rs(total)} />
                                        <KeyValue label="Advance" value={pd ? `${paise(pd.advancePaise)} paid` : o.quote?.advancePaise ? `${paise(o.quote.advancePaise)} asked` : '-'} />
                                        <KeyValue label="Balance" value={pd?.balancePaid ? `${paise(pd.balancePaise)} (${pd.balanceVia})` : o.quote?.balancePaise ? `${paise(o.quote.balancePaise)} to collect` : '-'} />
                                        <KeyValue
                                            label="Refund"
                                            value={pd?.refundStatus ? `${paise(pd.refundPaise)} ${pd.refundStatus === 'refunded' ? 'sent' : 'NOT SENT YET'}` : pd?.kept ? 'Advance kept by the shop' : '-'}
                                            last
                                        />
                                    </View>
                                    {refundPending ? <Text style={{ color: t.danger, fontWeight: '800', marginTop: spacing.sm }}>A refund did not go out yet. It is tried again by itself; check the shop's Razorpay balance.</Text> : null}
                                </Card>
                            </View>
                        );
                    })}
                    <SectionTitle section="settings">Read only</SectionTitle>
                    <Hint>The owner quotes, makes and hands over these orders. You see the money here; payments and refunds are also in Online payments.</Hint>
                </>
            )}
        </Screen>
    );
}
