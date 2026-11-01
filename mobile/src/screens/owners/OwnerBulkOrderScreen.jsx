// One bulk order, the owner's side: who asked for what, then the quote. The prices are filled in (the bulk price where a dish has one, else the
// menu price); change any of them, add a discount, set the delivery fee and the advance, and send. The server works out GST and the final total.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, Linking } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty, Sheet, SectionTitle } from '../../components/owners/ui';
import { TextBox, NumberBox, Group } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { rs } from '../../components/customers/orders';
import { addrLine } from '../../components/customers/addresses';
import { bulk as api, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { BULK_STATUS, bulkTone, whenText } from '../customers/BulkOrderDetailScreen';
import { tr } from '../../i18n';

export default function OwnerBulkOrderScreen() {
    const { id } = useRoute().params || {};
    const brand = useBrand();
    const { background, text, muted, primary, ok, error, border } = brand;
    const [o, setO] = useState(null);
    const [err, setErr] = useState('');
    const [st, setSt] = useState(null);             // the shop's bulk rules (the defaults of a quote)
    const [price, setPrice] = useState({});         // line id -> unit price
    const [gone, setGone] = useState({});           // line id -> left out of the quote
    const [discount, setDiscount] = useState(undefined);
    const [delivery, setDelivery] = useState(undefined);
    const [packaging, setPackaging] = useState(undefined);
    const [advance, setAdvance] = useState(undefined);
    const [hours, setHours] = useState(undefined);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [declineOpen, setDeclineOpen] = useState(false);
    const [reason, setReason] = useState('');

    const fill = useCallback((r, rules) => {
        setO(r);
        setPrice(Object.fromEntries(r.lines.map((l) => [l.id, l.unitPrice])));
        setGone({});
        setDelivery(r.pricing.deliveryFee);
        setPackaging(r.pricing.packagingCharge);
        setAdvance(rules?.advancePercent);
        setHours(rules?.quoteValidHours);
    }, []);
    const load = useCallback(async () => {
        try {
            const [r, rules] = await Promise.all([api.get(id), api.settings()]);
            setSt(rules); fill(r, rules); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this order.')); }
    }, [id, fill]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!o) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Bulk order')} />
                {err ? <Empty icon="alert-circle-outline" title={tr('Could not open this order')} hint={err} /> : <ListShimmer />}
            </View>
        );
    }
    const delivered = o.fulfilment === 'delivery';
    const kept = o.lines.filter((l) => !gone[l.id]);
    const subtotal = kept.reduce((n, l) => n + (Number(price[l.id]) || 0) * l.quantity, 0);

    const send = async () => {
        if (!kept.length) return showToast(tr('Keep at least one dish in the quote'));
        setBusy(true);
        try {
            const r = await api.quote(id, {
                lines: kept.map((l) => ({ id: l.id, unitPrice: Number(price[l.id]) || 0 })),
                ...(discount ? { discount } : {}), ...(delivered && delivery !== undefined ? { deliveryFee: delivery } : {}), ...(packaging !== undefined ? { packagingCharge: packaging } : {}),
                ...(advance ? { advancePercent: advance } : {}), ...(hours ? { validHours: hours } : {}), note: note.trim(),
            });
            setO(r); showToast(tr('Quote sent to the customer'));
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    const decline = async () => {
        if (!reason.trim()) return showToast(tr('Tell the customer why'));
        setBusy(true);
        try {
            const confirmedNow = o.status === 'confirmed';   // a paid order is cancelled and the whole advance goes back
            setO(confirmedNow ? await api.cancel(id, reason.trim()) : await api.decline(id, reason.trim()));
            setDeclineOpen(false); showToast(confirmedNow ? tr('Cancelled. The advance is being sent back.') : tr('Declined'));
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    const q = o.quote;
    const sent = q?.pricing && (['quoted', 'expired', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'].includes(o.status) || (o.status === 'cancelled' && !!o.payment));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={`${tr('Bulk order')} ${o.code}`} />
            <ScrollView contentContainerStyle={{ paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 16 }}>{o.contact?.company || o.contact?.name}</Text>
                        <Pill label={tr(BULK_STATUS[o.status] || o.status)} color={bulkTone(o.status, brand)} />
                    </View>
                    <Pressable onPress={() => Linking.openURL(`tel:${o.contact?.phone}`)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                        <Ionicons name="call-outline" size={16} color={primary} style={{ marginRight: 6 }} />
                        <Text style={{ color: primary, fontWeight: '800' }}>{o.contact?.name} · {o.contact?.phone}</Text>
                    </Pressable>
                    {o.contact?.onSitePhone ? <Text style={{ color: muted, marginTop: 4 }}>{tr('At the place')}: {o.contact.onSitePhone}</Text> : null}
                    {o.contact?.gstin ? <Text style={{ color: muted, marginTop: 4 }}>GSTIN {o.contact.gstin}</Text> : null}
                    <Text style={{ color: text, fontWeight: '800', marginTop: 8 }}>{delivered ? tr('Delivery') : tr('Pickup')} · {whenText(o.when)}</Text>
                    {delivered && o.address ? <Text style={{ color: muted, marginTop: 2 }}>{addrLine(o.address)}{o.distanceKm ? ` (${o.distanceKm} km)` : ''}</Text> : null}
                    <Text style={{ color: muted, marginTop: 4, fontSize: 12.5 }}>
                        {[o.cutlery ? tr('Send cutlery') : tr('No cutlery'), o.packaging === 'boxes' ? tr('Individual boxes') : o.packaging === 'trays' ? tr('Big trays') : tr('Any packing')].join(' · ')}
                    </Text>
                    {o.note ? <Text style={{ color: text, marginTop: 6 }}>“{o.note}”</Text> : null}
                    {o.changeNote ? <Text style={{ color: error, fontWeight: '800', marginTop: 8 }}>{tr('The customer asked to change the quote: {n}', { n: o.changeNote })}</Text> : null}
                    {o.status === 'declined' && o.declineReason ? <Text style={{ color: muted, marginTop: 8 }}>{tr('You declined: {r}', { r: o.declineReason })}</Text> : null}
                </Card>

                {o.status === 'requested' ? (
                    <>
                        <Group title={tr('Your quote')} hint={tr('Prices are filled in. Change any of them. GST and the final total are worked out when you send.')}>
                            {o.lines.map((l) => (
                                <View key={l.id} style={{ opacity: gone[l.id] ? 0.4 : 1, paddingBottom: 6 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ flex: 1, color: text, fontWeight: '800' }}>{l.quantity} × {l.name}{l.options?.length ? ` · ${l.options.join(', ')}` : ''}</Text>
                                        <Pressable onPress={() => setGone((g) => ({ ...g, [l.id]: !g[l.id] }))} hitSlop={8}>
                                            <Text style={{ color: gone[l.id] ? primary : error, fontWeight: '800' }}>{gone[l.id] ? tr('Add back') : tr('Remove')}</Text>
                                        </Pressable>
                                    </View>
                                    <Text style={{ color: l.bulkApplied ? ok : muted, fontSize: 12, marginBottom: 4 }}>{l.bulkApplied ? `${tr('Bulk price, menu price')} ${rs(l.listPrice)}` : `${tr('Menu price')} ${rs(l.listPrice ?? l.unitPrice)}`}</Text>
                                    {!gone[l.id] ? <NumberBox prefix="₹" suffix={tr('each')} value={price[l.id]} onChange={(x) => setPrice((p) => ({ ...p, [l.id]: x }))} last /> : null}
                                </View>
                            ))}
                            <View style={{ height: 1, backgroundColor: border, marginVertical: 8 }} />
                            <Text style={{ color: text, fontWeight: '900', marginBottom: 12 }}>{tr('Items')}: {rs(subtotal)}</Text>
                            <NumberBox label={tr('Discount (₹)')} prefix="₹" value={discount} onChange={setDiscount} />
                            {delivered ? <NumberBox label={tr('Delivery fee')} hint={tr('Filled in from your bulk delivery fee')} prefix="₹" value={delivery} onChange={setDelivery} /> : null}
                            <NumberBox label={tr('Packaging')} prefix="₹" value={packaging} onChange={setPackaging} />
                            <NumberBox label={tr('Advance to confirm')} hint={tr('The customer pays this much now and the rest on {w}', { w: delivered ? tr('delivery') : tr('pickup') })} suffix="%" value={advance} onChange={setAdvance} />
                            <NumberBox label={tr('Quote is valid for')} suffix={tr('hours')} integer value={hours} onChange={setHours} />
                            <TextBox label={tr('Message to the customer (optional)')} value={note} onChangeText={setNote} multiline maxLength={500} placeholder={tr('For example: ready one hour before your time')} last />
                        </Group>
                        <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                            <Button label={tr('Send the quote')} icon="send" busy={busy} onPress={send} style={{ marginBottom: 10 }} />
                            <Button label={tr('Decline this order')} icon="close-circle-outline" kind="ghost" onPress={() => setDeclineOpen(true)} />
                        </View>
                    </>
                ) : (
                    <>
                        <SectionTitle title={sent ? tr('The quote you sent') : tr('What was asked (estimate)')} />
                        <Card>
                            {(sent ? q.lines : o.lines).map((l) => (
                                <View key={l.id || l.name} style={{ flexDirection: 'row', paddingVertical: 4 }}>
                                    <Text style={{ flex: 1, color: text }}>{l.quantity} × {l.name}{l.options?.length ? ` · ${l.options.join(', ')}` : ''}  <Text style={{ color: muted }}>@ {rs(l.unitPrice)}</Text></Text>
                                    <Text style={{ color: text, fontWeight: '800' }}>{rs(l.lineTotal)}</Text>
                                </View>
                            ))}
                            <View style={{ height: 1, backgroundColor: border, marginVertical: 8 }} />
                            {(() => { const p = sent ? q.pricing : o.pricing; return (
                                <>
                                    {p.discount > 0 ? <Text style={{ color: muted }}>{tr('Discount')}: − {rs(p.discount)}</Text> : null}
                                    {p.taxOnTop > 0 ? <Text style={{ color: muted }}>GST: {rs(p.taxOnTop)}</Text> : null}
                                    {delivered ? <Text style={{ color: muted }}>{tr('Delivery')}: {rs(p.deliveryFee)}</Text> : null}
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, marginTop: 4 }}>{tr('Total')}: {rs(p.total)}</Text>
                                </>
                            ); })()}
                            {sent ? <Text style={{ color: muted, marginTop: 6 }}>{tr('Advance {p}%: {a}. Balance: {b}.', { p: q.advancePercent, a: rs(q.advancePaise / 100), b: rs(q.balancePaise / 100) })}</Text> : null}
                            {o.status === 'quoted' ? <Text style={{ color: muted, marginTop: 6 }}>{tr('Waiting for the customer. Valid until {t}.', { t: whenText(q.validUntil) })}</Text> : null}
                            {o.status === 'expired' ? <Text style={{ color: muted, marginTop: 6 }}>{tr('This quote ran out. The customer can ask again.')}</Text> : null}
                        </Card>
                        {o.payment ? (
                            <Card>
                                <Text style={{ color: text, fontWeight: '900' }}>{tr('Advance received: {a}', { a: rs(o.payment.advancePaise / 100) })}</Text>
                                {o.status === 'confirmed' ? <Text style={{ color: muted, marginTop: 4 }}>{tr('The balance of {b} is paid on {w}. If you cancel, the customer gets the whole advance back.', { b: rs(q.balancePaise / 100), w: delivered ? tr('delivery') : tr('pickup') })}</Text> : null}
                                {o.status === 'cancelled' && o.cancelledBy === 'customer' ? <Text style={{ color: muted, marginTop: 4 }}>{o.payment.kept ? tr('The customer cancelled late: you keep the advance.') : tr('The customer cancelled in time: the advance goes back to him.')}</Text> : null}
                                {o.status === 'cancelled' && o.cancelledBy === 'owner' ? <Text style={{ color: muted, marginTop: 4 }}>{tr('You cancelled: the whole advance goes back to the customer.')}</Text> : null}
                                {o.payment.refundStatus === 'refunded' ? <Text style={{ color: ok, marginTop: 4, fontWeight: '700' }}>{tr('Refund of {a} sent.', { a: rs(o.payment.refundPaise / 100) })}</Text> : null}
                                {o.payment.refundStatus === 'pending' ? <Text style={{ color: error, marginTop: 4, fontWeight: '700' }}>{tr('Refund of {a} not sent yet. It will be tried again by itself. If your Razorpay balance is low, add some.', { a: rs(o.payment.refundPaise / 100) })}</Text> : null}
                            </Card>
                        ) : null}
                        {o.status === 'quoted' ? <View style={{ paddingHorizontal: 16, marginTop: 12 }}><Button label={tr('Decline this order')} icon="close-circle-outline" kind="ghost" onPress={() => setDeclineOpen(true)} /></View> : null}
                        {o.status === 'confirmed' ? <View style={{ paddingHorizontal: 16, marginTop: 12 }}><Button label={tr('Cancel and refund the advance')} icon="close-circle-outline" kind="ghost" onPress={() => setDeclineOpen(true)} /></View> : null}
                    </>
                )}
            </ScrollView>

            <Sheet visible={declineOpen} onClose={() => setDeclineOpen(false)} title={tr('Why can you not take it?')}>
                <TextBox value={reason} onChangeText={setReason} multiline maxLength={300} placeholder={tr('The customer will read this')} last />
                <View style={{ height: 12 }} />
                <Button label={tr('Decline')} kind="danger" busy={busy} onPress={decline} />
            </Sheet>
        </View>
    );
}
