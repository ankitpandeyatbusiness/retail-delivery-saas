// Blocking a customer: say why (it is kept, with the time), and see it later in Customers > Blocked, where he can be unblocked.
import React, { useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet, Pill } from './ui';
import { blockCustomer, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const REASONS = ['Fake or prank orders', 'Did not pay', 'Did not collect orders', 'Rude or abusive', 'Other'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const stamp = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${x.getDate()} ${MON[x.getMonth()]} ${x.getFullYear()}, ${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const TYPE = { delivery: 'Delivery', pickup: 'Pickup', dine_in: 'Dine in' };
const STATUS = { placed: 'Placed', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', undelivered: 'Not delivered' };

// the form: reasons to tap, a note, and Block. orderId / sessionId: the order or table bill this is about (kept with the block).
export function BlockSheet({ visible, customer, orderId, sessionId, onClose, onBlocked }) {
    const { text, muted, border, primary, onPrimary } = useBrand();
    const [pick, setPick] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const go = async () => {
        const reason = [pick, note.trim()].filter(Boolean).join(': ');
        if (!reason) { showToast(tr('Choose a reason or write one')); return; }
        setBusy(true);
        try {
            await blockCustomer(customer.id, true, { reason, ...(orderId ? { orderId } : {}), ...(sessionId ? { sessionId } : {}) });
            showToast(tr('Customer blocked'));
            setPick(''); setNote('');
            onBlocked && onBlocked(reason);
            onClose();
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Block this customer?')}>
            <Text style={{ color: muted, marginBottom: 10 }}>{tr('He will not be able to use the app of your shop. You can unblock him later from Customers > Blocked.')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {REASONS.map((r) => {
                    const on = pick === r;
                    return (
                        <Pressable key={r} onPress={() => setPick(on ? '' : r)} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 18, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '700', fontSize: 13 }}>{tr(r)}</Text>
                        </Pressable>
                    );
                })}
            </View>
            <TextInput
                value={note} onChangeText={setNote} placeholder={tr('More details (optional)')} placeholderTextColor={muted} maxLength={200} multiline
                style={{ marginTop: 4, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, color: text, minHeight: 48, maxHeight: 90 }}
            />
            <Button label={tr('Block')} icon="ban" kind="danger" busy={busy} onPress={go} style={{ marginTop: 12 }} />
        </Sheet>
    );
}

// when, by whom, why, and the order or table bill it was about
export function BlockDetails({ b }) {
    const { text, muted, error, border } = useBrand();
    const by = b.byType === 'platform' ? tr('the platform team') : tr('you');
    return (
        <View>
            <Text style={{ color: muted, fontSize: 12.5 }}>{b.at ? tr('Blocked on {when} by {by}', { when: stamp(b.at), by }) : tr('Blocked earlier (the time was not recorded)')}</Text>
            <Text style={{ color: b.reason ? text : muted, fontWeight: '800', marginTop: 6 }}>{b.reason ? `${tr('Reason')}: ${b.reason}` : tr('No reason was written')}</Text>
            {b.order ? (
                <View style={{ marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: border }}>
                    <Text style={{ color: text, fontWeight: '900' }}>{tr('Order #{n}', { n: b.order.orderNo })} · {tr(TYPE[b.order.orderType] || b.order.orderType)} · {rs(b.order.total)}</Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr(STATUS[b.order.status] || b.order.status)} · {stamp(b.order.at)} · {b.order.pay?.method === 'cod' ? tr('Cash') : tr('Online')}{b.order.pay?.status === 'paid' ? ` · ${tr('Paid')}` : ''}</Text>
                    {b.order.items.length ? <Text style={{ color: text, marginTop: 4 }} numberOfLines={3}>{b.order.items.map((l) => `${l.quantity}× ${l.name}`).join(', ')}</Text> : null}
                    {b.order.cancelReason ? <Text style={{ color: error, marginTop: 4, fontSize: 12.5 }}>{b.order.cancelReason}</Text> : null}
                </View>
            ) : null}
            {b.table ? (
                <View style={{ marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: border }}>
                    <Text style={{ color: text, fontWeight: '900' }}>{tr('Table {t} bill', { t: b.table.table })} · {rs(b.table.amount)}</Text>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{b.table.cleared ? tr('Paid later') : tr('Still unpaid')}{b.table.at ? ` · ${stamp(b.table.at)}` : ''}</Text>
                </View>
            ) : null}
        </View>
    );
}

// one blocked customer in the list: the details, Call, and Unblock
export function BlockedCard({ b, onUnblock, busy }) {
    const { text, muted, border, error, primary } = useBrand();
    return (
        <View style={{ marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: alpha(error, 0.4), backgroundColor: alpha(error, 0.05) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{b.name || tr('Customer')}</Text>
                    {b.phone ? <Text style={{ color: muted, marginTop: 1 }}>{b.phone}</Text> : null}
                </View>
                <Pill label={tr('Blocked')} color={error} />
            </View>
            <View style={{ marginTop: 10 }}><BlockDetails b={b} /></View>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                {b.phone ? <Button label={tr('Call')} icon="call" kind="ghost" onPress={() => Linking.openURL('tel:' + b.phone)} style={{ flex: 1, marginRight: 8 }} /> : null}
                <Button label={tr('Unblock')} icon="checkmark-circle" busy={busy} onPress={() => onUnblock(b)} style={{ flex: 1 }} />
            </View>
        </View>
    );
}
