// One bulk order, as the customer sees it: what he asked for, and the shop's quote as a clear bill. He can ask for a change or cancel.
// (Accepting the quote and paying the advance comes in the next update.)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import useBulkLive from '../../hooks/common/useBulkLive';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty, Sheet, SectionTitle } from '../../components/owners/ui';
import { TextBox } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { rs } from '../../components/customers/orders';
import { addrLine } from '../../components/customers/addresses';
import { fetchBulk, cancelBulk, changeBulk, startBulkPay, startBulkBalance, previewCancelBulk } from '../../api/customers/shopApi';
import { viewInvoice, saveInvoice } from '../../components/customers/invoice';
import { onNotification } from '../../api/common/socket';
import { Thumb } from './BulkOrderScreen';
import ChatButton from '../../components/common/ChatButton';
import BulkFeedback from '../../components/customers/BulkFeedback';
import { tr } from '../../i18n';
import { DeskCols } from '../../components/common/DeskGrid';

export const BULK_STATUS = {
    requested: 'Waiting for the shop\'s quote', quoted: 'Quote received', confirmed: 'Confirmed', preparing: 'Being made', ready: 'Ready', out_for_delivery: 'On the way',
    delivered: 'Delivered', completed: 'Completed', declined: 'Declined by the shop', cancelled: 'Cancelled', expired: 'Quote expired',
};
// what the customer is told at each step of a paid order (the argument is "is it a delivery")
const STAGE_TEXT = {
    confirmed: () => 'Your order is confirmed. The shop will start making it.',
    preparing: () => 'The shop is making your order.',
    ready: (d) => (d ? 'Your order is packed and will go out soon.' : 'Your order is ready. Collect it at the time you chose.'),
    out_for_delivery: () => 'Your order is on the way.',
    delivered: (d) => (d ? 'Delivered.' : 'Handed over.'),
    completed: () => 'Completed. Thank you!',
};
export const bulkTone =(st, b) => (['declined', 'cancelled', 'expired'].includes(st) ? b.error : ['confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'].includes(st) ? b.ok : b.primary);
export const whenText = (d) => new Date(d).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// was = the same dish in the customer's own estimate: when the shop changed its price, the old one is struck through next to the new one
function Line({ l, text, muted, ok, was }) {
    const changed = was && Math.abs((was.unitPrice || 0) - (l.unitPrice || 0)) > 0.005;
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 5 }}>
            <View style={{ marginRight: 10 }}><Thumb uri={l.image} size={40} /></View>
            <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: text, fontWeight: '700' }}>{l.name}{l.options?.length ? ` · ${l.options.join(', ')}` : ''}</Text>
                <Text style={{ color: l.bulkApplied ? ok : muted, fontSize: 12 }}>{l.quantity} × {changed ? <Text style={{ textDecorationLine: 'line-through' }}>{rs(was.unitPrice)}</Text> : null}{changed ? '  ' : ''}{rs(l.unitPrice)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
                {changed ? <Text style={{ color: muted, fontSize: 12, textDecorationLine: 'line-through' }}>{rs(was.lineTotal)}</Text> : null}
                <Text style={{ color: text, fontWeight: '800' }}>{rs(l.lineTotal)}</Text>
            </View>
        </View>
    );
}
// one row of "what the shop changed": the old amount struck through, then the new one
function Delta({ k, was, now, text, muted, bold }) {
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 2, alignItems: 'center' }}>
            <Text style={{ flex: 1, color: bold ? text : muted, fontWeight: bold ? '900' : '600' }}>{k}</Text>
            {was !== null && was !== undefined ? <Text style={{ color: muted, textDecorationLine: 'line-through', marginRight: 8 }}>{rs(was)}</Text> : null}
            <Text style={{ color: text, fontWeight: bold ? '900' : '700' }}>{now}</Text>
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
    const nav = useNavigation();
    const { id, refresh } = useRoute().params || {};
    const brand = useBrand();
    const { background, text, muted, ok, border } = brand;
    const [o, setO] = useState(null);
    const [err, setErr] = useState('');
    const [changeOpen, setChangeOpen] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => { fetchBulk(id).then((r) => { setO(r); setErr(''); }).catch((e) => setErr(e?.response?.data?.error || tr('Could not load'))); }, [id]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useBulkLive(load, id);
    useEffect(() => onNotification((n) => { if (String(n?.type).startsWith('bulk_')) load(); }), [load]);
    useEffect(() => { if (refresh) load(); }, [refresh, load]);   // back from paying: look again

    // Accept the quote: the server makes the Razorpay order for exactly the advance, then the usual payment screen opens
    const pay = async () => {
        setBusy(true);
        try { nav.navigate('PaymentMethods', { bulk: { order: o, pay: await startBulkPay(id) }, current: 'upi' }); }
        catch (e) { showToast(e?.response?.data?.error || tr('Could not start the payment')); load(); } finally { setBusy(false); }
    };

    // The balance, at the handover: the same payment screen, for the amount that is left
    const payBalance = async () => {
        setBusy(true);
        try { nav.navigate('PaymentMethods', { bulk: { order: o, pay: await startBulkBalance(id), kind: 'balance' }, current: 'upi' }); }
        catch (e) { showToast(e?.response?.data?.error || tr('Could not start the payment')); load(); } finally { setBusy(false); }
    };
    const invoiceOf = (x) => ({ id: x.id, orderNo: `B${x.code}`, createdAt: x.completedAt || x.updatedAt, invoicePath: `/bulk/${x.id}/invoice` });
    const [inv, setInv] = useState('');

    // The popup says the exact amount: it comes from the server, from the same rule the real cancel uses
    const cancel = async () => {
        let p = null;
        try { p = await previewCancelBulk(id); } catch (e) { p = null; }
        const money = (paise) => rs(paise / 100);
        const message = !p || !p.paid ? tr('Nothing has been paid, so there is nothing to refund.')
            : p.refundPaise > 0 ? `${tr('You will get {amount} back as a refund.', { amount: money(p.refundPaise) })}\n\n${tr('It reaches your account in 5 to 7 working days.')}`
                : tr('Too late for a refund: you cancel less than {h} hours before the time, so the shop keeps your advance of {amount}.', { h: p.refundHours, amount: money(p.keptPaise) });
        if (!(await ask({ title: tr('Cancel this order?'), message, confirmText: tr('Cancel order'), cancelText: tr('Go back'), destructive: true }))) return;
        setBusy(true);
        try { setO(await cancelBulk(id)); showToast(p?.refundPaise > 0 ? tr('Cancelled. {amount} will be refunded.', { amount: money(p.refundPaise) }) : tr('Cancelled')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not cancel')); load(); } finally { setBusy(false); }
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
    const showQuote = q && (['quoted', 'expired', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'delivered', 'completed'].includes(o.status) || (o.status === 'cancelled' && !!o.payment));
    const lines = showQuote ? q.lines : o.lines;
    const p = showQuote ? q.pricing : o.pricing;
    const open = !!o.cancel?.canCancel;   // before paying always; after paying only while the shop has not started
    const pd = o.payment;                 // { advancePaise, paidAt, kept, refundPaise, refundStatus } once the advance is paid
    // the customer's own estimate, by dish, and what is different in the quote (so a change by the shop is never a surprise)
    const asked = new Map((o.lines || []).map((l) => [String(l.id), l]));
    const changes = [];
    if (showQuote && o.pricing && q?.pricing) {
        const a = o.pricing; const b = q.pricing; const diff = (x, y) => Math.abs((x || 0) - (y || 0)) > 0.005;
        if (diff(a.subtotal, b.subtotal)) changes.push({ k: tr('Items'), was: a.subtotal, now: rs(b.subtotal) });
        if (b.discount > 0) changes.push({ k: b.discountPercent ? tr('Shop discount ({p}%)', { p: b.discountPercent }) : tr('Discount'), was: null, now: `− ${rs(b.discount)}` });
        if (diff(a.packagingCharge, b.packagingCharge)) changes.push({ k: tr('Packaging'), was: a.packagingCharge, now: rs(b.packagingCharge) });
        if (o.fulfilment === 'delivery' && diff(a.deliveryFee, b.deliveryFee)) changes.push({ k: tr('Delivery'), was: a.deliveryFee, now: b.deliveryFee > 0 ? rs(b.deliveryFee) : tr('Free') });
        if (diff(a.taxOnTop, b.taxOnTop)) changes.push({ k: tr('GST'), was: a.taxOnTop, now: rs(b.taxOnTop) });
        if (!diff(a.total, b.total) && !changes.length) changes.length = 0;
    }

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={`${tr('Bulk order')} ${o.code}`} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <DeskCols>
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
                    {o.status === 'cancelled' && o.cancelledBy === 'owner' && o.cancelReason ? <Text style={{ color: text, marginTop: 8 }}>{tr('The shop said: {r}', { r: o.cancelReason })}</Text> : null}
                    {o.status === 'requested' && o.changeNote ? <Text style={{ color: muted, marginTop: 8 }}>{tr('You asked: {r}', { r: o.changeNote })}</Text> : null}
                </Card>

                <View style={{ paddingHorizontal: 16, marginVertical: 12 }}><ChatButton kind="bulk" refId={o.id} title={`${tr('Bulk order')} ${o.code}`} label={tr('Chat with the shop')} /></View>

                {/* the pickup code: shown while the order is being made, to be told at the counter */}
                {o.pickupCode ? (
                    <View style={{ alignItems: 'center', marginHorizontal: 16, marginTop: 12, padding: 16, borderRadius: 18, backgroundColor: brand.primary + '1F' }}>
                        <Text style={{ color: muted, fontWeight: '700', fontSize: 12.5 }}>{tr('YOUR PICKUP CODE')}</Text>
                        <Text style={{ color: brand.primary, fontSize: 40, fontWeight: '900', letterSpacing: 12, marginTop: 4, paddingLeft: 12 }}>{o.pickupCode}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 6, textAlign: 'center' }}>{o.status === 'ready' ? tr('Your order is ready. Show this code when you collect it.') : tr('Show this code when you collect your order.')}</Text>
                    </View>
                ) : null}

                {/* what the shop changed against the customer's own estimate */}
                {showQuote && changes.length ? (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900', marginBottom: 6 }}>{tr('What the shop changed')}</Text>
                        {changes.map((c) => <Delta key={c.k} k={c.k} was={c.was} now={c.now} text={text} muted={muted} />)}
                        <View style={{ height: 1, backgroundColor: border, marginVertical: 6 }} />
                        <Delta k={tr('Your estimate became')} was={o.pricing.total} now={rs(q.pricing.total)} text={text} muted={muted} bold />
                    </Card>
                ) : null}

                <SectionTitle title={showQuote ? tr('The shop\'s quote') : tr('What you asked for (estimate)')} />
                <Card>
                    {lines.map((l) => <Line key={l.id || l.productId + l.name} l={l} text={text} muted={muted} ok={ok} was={showQuote ? asked.get(String(l.id)) : undefined} />)}
                    <View style={{ height: 1, backgroundColor: border, marginVertical: 8 }} />
                    <Sum k={tr('Items')} v={rs(p.subtotal)} text={text} muted={muted} />
                    {p.discount > 0 ? <Sum k={p.discountPercent ? tr('Shop discount ({p}%)', { p: p.discountPercent }) : tr('Discount')} v={`− ${rs(p.discount)}`} text={text} muted={muted} /> : null}
                    {p.taxOnTop > 0 ? <Sum k={tr('GST')} v={rs(p.taxOnTop)} text={text} muted={muted} /> : null}
                    {p.packagingCharge > 0 ? <Sum k={tr('Packaging')} v={rs(p.packagingCharge)} text={text} muted={muted} /> : null}
                    {o.fulfilment === 'delivery' ? <Sum k={tr('Delivery')} v={p.deliveryFee > 0 ? rs(p.deliveryFee) : tr('Free')} text={text} muted={muted} /> : null}
                    <Sum k={tr('Total')} v={rs(p.total)} bold text={text} muted={muted} />
                    {showQuote ? (
                        <View style={{ marginTop: 10 }}>
                            <Sum k={o.payment ? tr('Advance paid ({p}%)', { p: q.advancePercent }) : tr('To pay now to confirm ({p}%)', { p: q.advancePercent })} v={rs(q.advancePaise / 100)} bold text={text} muted={muted} />
                            <Sum k={tr('Balance, on {w}', { w: o.fulfilment === 'delivery' ? tr('delivery') : tr('pickup') })} v={rs(q.balancePaise / 100)} text={text} muted={muted} />
                            {q.prepHours ? <Text style={{ color: text, fontSize: 13, marginTop: 6 }}>{tr('The shop needs about {n} hours to make this', { n: q.prepHours })}</Text> : null}
                            {o.status === 'quoted' && q.validUntil ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('This quote is valid until {t}', { t: whenText(q.validUntil) })}</Text> : null}
                            {o.status === 'expired' ? <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('This quote has run out. Ask the shop for a new one.')}</Text> : null}
                            {q.note ? <Text style={{ color: text, marginTop: 8 }}>{tr('The shop says: {n}', { n: q.note })}</Text> : null}
                        </View>
                    ) : null}
                </Card>

                {pd ? (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900' }}>{tr('Advance paid: {a}', { a: rs(pd.advancePaise / 100) })}</Text>
                        {pd.refundStatus === 'refunded' ? <Text style={{ color: ok, marginTop: 4, fontWeight: '700' }}>{tr('{a} has been sent back to you. Your bank may take 5 to 7 working days to show it.', { a: rs(pd.refundPaise / 100) })}</Text> : null}
                        {pd.refundStatus === 'pending' ? <Text style={{ color: muted, marginTop: 4 }}>{tr('Your refund of {a} is being sent. It can take a little while.', { a: rs(pd.refundPaise / 100) })}</Text> : null}
                        {pd.kept ? <Text style={{ color: muted, marginTop: 4 }}>{tr('The shop keeps the advance.')}</Text> : null}
                        {STAGE_TEXT[o.status] ? <Text style={{ color: text, marginTop: 6, fontWeight: '700' }}>{tr(STAGE_TEXT[o.status](o.fulfilment === 'delivery'))}</Text> : null}
                        {pd.balancePaid ? <Text style={{ color: ok, marginTop: 4, fontWeight: '700' }}>{tr('Balance paid: {a} ({how})', { a: rs(pd.balancePaise / 100), how: pd.balanceVia === 'cash' ? tr('cash') : pd.balanceVia === 'upi' ? tr('UPI') : tr('online') })}</Text> : null}
                        {!pd.balancePaid && o.quote?.balancePaise > 0 && ['confirmed', 'preparing'].includes(o.status) ? <Text style={{ color: muted, marginTop: 4 }}>{tr('The balance of {a} is paid at the handover, in the app or in cash to the shop.', { a: rs(o.quote.balancePaise / 100) })}</Text> : null}
                        {!pd.balancePaid && o.quote?.balancePaise > 0 && ['ready', 'out_for_delivery', 'delivered'].includes(o.status) ? <Text style={{ color: text, marginTop: 4, fontWeight: '800' }}>{(o.fulfilment === 'delivery' ? tr('Balance to pay: {a}. Pay it in the app now, or online with the QR the delivery partner shows, or in cash to him.', { a: rs(o.quote.balancePaise / 100) }) : tr('Balance to pay: {a}. Pay it in the app, or in cash to the shop.', { a: rs(o.quote.balancePaise / 100) }))}</Text> : null}
                    </Card>
                ) : null}
                {o.trackOrderId ? (
                    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                        <Button label={tr('Track the delivery')} icon="bicycle-outline" onPress={() => nav.navigate('OrderDetail', { id: o.trackOrderId })} />
                    </View>
                ) : null}
                {o.balance?.ok ? (
                    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                        <Button label={tr('Pay the balance {a} now', { a: rs(o.balance.paise / 100) })} icon="lock-closed" busy={busy} onPress={payBalance} />
                    </View>
                ) : null}
                {o.invoiceReady ? (
                    <Card>
                        <Text style={{ color: text, fontWeight: '900', marginBottom: 8 }}>{tr('Invoice')}</Text>
                        <View style={{ flexDirection: 'row' }}>
                            <Button label={tr('View')} icon="document-text-outline" kind="ghost" busy={inv === 'view'} onPress={() => viewInvoice(invoiceOf(o), (v) => setInv(v ? 'view' : ''))} style={{ flex: 1, marginRight: 10 }} />
                            <Button label={tr('Save')} icon="download-outline" kind="ghost" busy={inv === 'save'} onPress={() => saveInvoice(invoiceOf(o), (v) => setInv(v ? 'save' : ''))} style={{ flex: 1 }} />
                        </View>
                    </Card>
                ) : null}
                {o.canPay && q ? (
                    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                        <Button label={tr('Accept and pay {a} now', { a: rs(q.advancePaise / 100) })} icon="lock-closed" busy={busy} onPress={pay} style={{ marginBottom: 6 }} />
                        <Text style={{ color: muted, fontSize: 12, marginBottom: 10 }}>{tr('Cancel at least {h} hours before the time and the whole advance comes back. Later, the shop keeps it.', { h: q.fullRefundHours ?? 0 })}</Text>
                    </View>
                ) : null}
                {o.feedbackOrderId ? <BulkFeedback ticketId={o.feedbackOrderId} delivery={o.fulfilment === 'delivery'} /> : null}
                {open ? (
                    <View style={{ paddingHorizontal: 16, marginTop: 12 }}>
                        {['quoted', 'expired'].includes(o.status) ? <Button label={tr('Ask for a change')} icon="create-outline" kind="ghost" onPress={() => setChangeOpen(true)} style={{ marginBottom: 10 }} /> : null}
                        <Button label={o.status === 'confirmed' ? tr('Cancel this order') : tr('Cancel this request')} icon="close-circle-outline" kind="ghost" busy={busy} onPress={cancel} />
                    </View>
                ) : null}
                </DeskCols>
            </ScrollView>

            <Sheet visible={changeOpen} onClose={() => setChangeOpen(false)} title={tr('What should change?')}>
                <TextBox value={note} onChangeText={setNote} multiline maxLength={500} placeholder={tr('For example: please make the delivery free, or reduce the naan to 40')} last />
                <View style={{ height: 12 }} />
                <Button label={tr('Send to the shop')} icon="send" busy={busy} onPress={change} />
            </Sheet>
        </View>
    );
}
