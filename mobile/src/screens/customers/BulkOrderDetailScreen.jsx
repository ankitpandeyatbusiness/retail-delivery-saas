// One bulk order, as the customer sees it: what he asked for, and the shop's quote as a clear bill. He can ask for a change or cancel.
// (Accepting the quote and paying the advance comes in the next update.)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty, Sheet, SectionTitle } from '../../components/owners/ui';
import { TextBox } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { rs } from '../../components/customers/orders';
import { addrLine } from '../../components/customers/addresses';
import { fetchBulk, cancelBulk, changeBulk } from '../../api/customers/shopApi';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';

export const BULK_STATUS = {
    requested: 'Waiting for the shop\'s quote', quoted: 'Quote received', confirmed: 'Confirmed', preparing: 'Being made', ready: 'Ready', out_for_delivery: 'On the way',
    delivered: 'Delivered', completed: 'Completed', declined: 'Declined by the shop', cancelled: 'Cancelled', expired: 'Quote expired',
};
export const bulkTone = (st, b) => (['declined', 'cancelled', 'expired'].includes(st) ? b.error : ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'].includes(st) ? b.ok : b.primary);
export const whenText = (d) => new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

function Line({ l, text, muted, ok }) {
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 5 }}>
            <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: text, fontWeight: '700' }}>{l.name}{l.options?.length ? ` · ${l.options.join(', ')}` : ''}</Text>
                <Text style={{ color: l.bulkApplied ? ok : muted, fontSize: 12 }}>{l.quantity} × {rs(l.unitPrice)}</Text>
            </View>
            <Text style={{ color: text, fontWeight: '800' }}>{rs(l.lineTotal)}</Text>
        </View>
    );
}
function Sum({ k, v, bold, text, muted }) {
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 2 }}>
            <Text style={{ flex: 1, color: bold ? text : muted, fontWeight: bold ? '900' : '600' }}>{k}</Text>
            <Text style={{ color: text, fontWeight: bold ? '900' : '700' }}>{v}</Text>
        </View>
    );
}

export default function BulkOrderDetailScreen() {
    const { id } = useRoute().params || {};
    const brand = useBrand();
    const { background, text, muted, ok, border } = brand;
    const [o, setO] = useState(null);
    const [err, setErr] = useState('');
    const [changeOpen, setChangeOpen] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => { fetchBulk(id).then((r) => { setO(r); setErr(''); }).catch((e) => setErr(e?.response?.data?.error || tr('Could not load'))); }, [id]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => onNotification((n) => { if (['bulk_quoted', 'bulk_declined'].includes(String(n?.type))) load(); }), [load]);

    const cancel = async () => {
        if (!(await ask({ title: tr('Cancel this request?'), message: tr('Nothing has been paid, so there is nothing to refund.'), confirmText: tr('Cancel request'), cancelText: tr('Go back'), destructive: true }))) return;
        setBusy(true);
        try { setO(await cancelBulk(id)); showToast(tr('Cancelled')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not cancel')); } finally { setBusy(false); }
    };
    const change = async () => {
        if (!note.trim()) return showToast(tr('Tell the shop what to change'));
        setBusy(true);
        try { setO(await changeBulk(id, note.trim())); setChangeOpen(false); setNote(''); showToast(tr('Sent. The shop will send a new quote.')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send')); } finally { setBusy(false); }
    };

    if (!o) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Bulk order')} />
                {err ? <Empty icon="alert-circle-outline" title={tr('Could not load')} hint={err} /> : <ListShimmer />}
            </View>
        );
    }
    const q = o.quote;
    const showQuote = q && ['quoted', 'expired', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'].includes(o.status);
    const lines = showQuote ? q.lines : o.lines;
    const p = showQuote ? q.pricing : o.pricing;
    const open = ['requested', 'quoted', 'expired'].includes(o.status);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={`${tr('Bulk order')} ${o.code}`} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 16 }}>{o.fulfilment === 'delivery' ? tr('Delivery') : tr('Pickup')} · {whenText(o.when)}</Text>
                        <Pill label={tr(BULK_STATUS[o.status] || o.status)} color={bulkTone(o.status, brand)} />
                    </View>
                    {o.fulfilment === 'delivery' && o.address ? <Text style={{ color: muted, marginTop: 6 }}>{addrLine(o.address)}</Text> : null}
                    <Text style={{ color: muted, marginTop: 6, fontSize: 12.5 }}>
                        {[o.cutlery ? tr('With cutlery') : tr('No cutlery'), o.packaging === 'boxes' ? tr('Individual boxes') : o.packaging === 'trays' ? tr('Big trays') : null, o.contact?.company].filter(Boolean).join(' · ')}
                    </Text>
                    {o.status === 'declined' && o.declineReason ? <Text style={{ color: text, marginTop: 8 }}>{tr('The shop said: {r}', { r: o.declineReason })}</Text> : null}
                    {o.status === 'requested' && o.changeNote ? <Text style={{ color: muted, marginTop: 8 }}>{tr('You asked: {r}', { r: o.changeNote })}</Text> : null}
                </Card>

                <SectionTitle title={showQuote ? tr('The shop\'s quote') : tr('What you asked for (estimate)')} />
                <Card>
                    {lines.map((l) => <Line key={l.id || l.productId + l.name} l={l} text={text} muted={muted} ok={ok} />)}
                    <View style={{ height: 1, backgroundColor: border, marginVertical: 8 }} />
                    <Sum k={tr('Items')} v={rs(p.subtotal)} text={text} muted={muted} />
                    {p.discount > 0 ? <Sum k={tr('Discount')} v={`− ${rs(p.discount)}`} text={text} muted={muted} /> : null}
                    {p.taxOnTop > 0 ? <Sum k={tr('GST')} v={rs(p.taxOnTop)} text={text} muted={muted} /> : null}
                    {p.packagingCharge > 0 ? <Sum k={tr('Packaging')} v={rs(p.packagingCharge)} text={text} muted={muted} /> : null}
                    {o.fulfilment === 'delivery' ? <Sum k={tr('Delivery')} v={p.deliveryFee > 0 ? rs(p.deliveryFee) : tr('Free')} text={text} muted={muted} /> : null}
                    <Sum k={tr('Total')} v={rs(p.total)} bold text={text} muted={muted} />
                    {showQuote ? (
                        <View style={{ marginTop: 10 }}>
                            <Sum k={tr('To pay now to confirm ({p}%)', { p: q.advancePercent })} v={rs(q.advancePaise / 100)} bold text={text} muted={muted} />
                            <Sum k={tr('Balance, on {w}', { w: o.fulfilment === 'delivery' ? tr('delivery') : tr('pickup') })} v={rs(q.balancePaise / 100)} text={text} muted={muted} />
                            {o.status === 'quoted' && q.validUntil ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('This quote is valid until {t}', { t: whenText(q.validUntil) })}</Text> : null}
                            {o.status === 'expired' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('This quote has run out. Ask the shop for a new one.')}</Text> : null}
                            {q.note ? <Text style={{ color: text, marginTop: 8 }}>{tr('The shop says: {n}', { n: q.note })}</Text> : null}
                        </View>
                    ) : null}
                </Card>

                {o.status === 'quoted' ? <Text style={{ color: muted, marginHorizontal: 20, marginTop: 4, fontSize: 12.5 }}>{tr('Paying the advance online will open in the next update. For now you can ask for a change, or talk to the shop.')}</Text> : null}
                {open ? (
                    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                        {o.status !== 'requested' ? <Button label={tr('Ask for a change')} icon="create-outline" kind="ghost" onPress={() => setChangeOpen(true)} style={{ marginBottom: 10 }} /> : null}
                        <Button label={tr('Cancel this request')} icon="close-circle-outline" kind="ghost" busy={busy} onPress={cancel} />
                    </View>
                ) : null}
            </ScrollView>

            <Sheet visible={changeOpen} onClose={() => setChangeOpen(false)} title={tr('What should change?')}>
                <TextBox value={note} onChangeText={setNote} multiline maxLength={500} placeholder={tr('For example: please make the delivery free, or reduce the naan to 40')} last />
                <View style={{ height: 12 }} />
                <Button label={tr('Send to the shop')} icon="send" busy={busy} onPress={change} />
            </Sheet>
        </View>
    );
}
