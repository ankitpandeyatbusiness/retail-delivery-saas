// One table's bill for the waiter: every round with its dishes and state, what is left to pay, and (when the shop allows it) the buttons to say the
// money was taken by cash or UPI. A dish that is not served yet stops the payment, with the reason on screen.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Sheet, Pill, money } from '../owners/ui';
import { ListShimmer } from '../owners/shimmer';
import { BigButton } from './staffBits';
import { fetchTableBill, waiterSettle } from '../../api/staff/staffApi';
import { apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

const STAGE = (status) => (status === 'delivered' ? ['Served', 'ok'] : status === 'ready' ? ['Ready to serve', 'primary'] : ['Cooking', 'muted']);

export default function TableSheet({ session, onClose, onPaid }) {
    const { text, muted, border, ok, primary, warn, error } = useBrand();
    const [bill, setBill] = useState(null);
    const [failed, setFailed] = useState('');
    const [busy, setBusy] = useState('');
    const load = useCallback(() => {
        fetchTableBill(session.sessionId).then((b) => { setBill(b); setFailed(''); }).catch((e) => setFailed(apiError(e, tr('Could not open the bill.'))));
    }, [session]);
    useEffect(() => { setBill(null); setFailed(''); if (session) load(); }, [session, load]);

    const pay = async (method) => {
        const how = method === 'cash' ? tr('cash') : tr('UPI');
        const yes = await ask({
            title: tr('Take {amount} by {how}?', { amount: money(bill.payable), how }),
            message: tr('Table {n} will be closed. Check that the money is in your hand (or the UPI payment shows success).', { n: bill.table }),
            confirmText: tr('Yes, paid'), cancelText: tr('Go back'),
        });
        if (!yes) return;
        setBusy(method);
        try { await waiterSettle(session.sessionId, method); showToast(tr('Table {n} is paid.', { n: bill.table })); onPaid(); } catch (e) { showToast(apiError(e)); load(); } finally { setBusy(''); }
    };

    const unserved = bill?.rounds?.some((r) => r.status !== 'delivered');
    return (
        <Sheet visible={!!session} onClose={onClose} title={session ? tr('Table {n}', { n: session.table }) : ''}>
            {session ? (
                <ScrollView style={{ maxHeight: 560 }} showsVerticalScrollIndicator={false}>
                    {!bill && !failed ? <ListShimmer count={2} /> : null}
                    {failed ? <Text style={{ color: error, fontWeight: '700', marginVertical: 12 }}>{failed}</Text> : null}
                    {bill ? (
                        <View>
                            {bill.rounds.length === 0 ? <Text style={{ color: muted, marginVertical: 12 }}>{tr('Nothing ordered yet.')}</Text> : null}
                            {bill.rounds.map((r) => {
                                const [label, tone] = STAGE(r.status);
                                const c = tone === 'ok' ? ok : tone === 'primary' ? primary : muted;
                                return (
                                    <View key={r.id} style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: border }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
                                            <Text style={{ color: text, fontWeight: '900', flex: 1 }}>#{r.orderNo}</Text>
                                            <Pill label={tr(label)} color={c} />
                                            <Text style={{ color: text, fontWeight: '900', marginLeft: 10, minWidth: 64, textAlign: 'right' }}>{money(r.total)}{r.paid ? ' ✓' : ''}</Text>
                                        </View>
                                        {r.items.map((l, i) => (
                                            <Text key={i} style={{ color: muted, fontWeight: '600' }}>{l.quantity}× {l.name}{l.addons?.length ? ` (${l.addons.join(', ')})` : ''}</Text>
                                        ))}
                                    </View>
                                );
                            })}
                            <View style={{ marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: alpha(primary, 0.1) }}>
                                <Row label={tr('Total')} value={money(bill.total)} />
                                {bill.tip > 0 ? <Row label={tr('Tip')} value={money(bill.tip)} /> : null}
                                <Row label={tr('To pay')} value={money(bill.payable)} big />
                            </View>
                            {bill.status === 'bill_asked' ? <Text style={{ color: warn, fontWeight: '800', marginTop: 10 }}>{tr('The guest asked for the bill.')}</Text> : null}
                            {unserved ? <Text style={{ color: warn, fontWeight: '700', marginTop: 10 }}>{tr('Some dishes are not served yet. Serve them first, then take the money.')}</Text> : null}
                            {bill.canSettle ? (
                                <View style={{ marginTop: 14, marginBottom: 6 }}>
                                    <BigButton label={tr('Cash received')} icon="cash" bg={ok} ink="#FFFFFF" busy={busy === 'cash'} disabled={unserved || !!busy || bill.payable <= 0} onPress={() => pay('cash')} />
                                    <View style={{ height: 10 }} />
                                    <BigButton label={tr('UPI received')} icon="phone-portrait" bg={primary} ink="#FFFFFF" busy={busy === 'upi'} disabled={unserved || !!busy || bill.payable <= 0} onPress={() => pay('upi')} />
                                </View>
                            ) : <Text style={{ color: muted, fontWeight: '600', marginTop: 14 }}>{bill.status === 'closed' ? tr('This bill is paid.') : tr('The owner takes the money for this bill.')}</Text>}
                        </View>
                    ) : null}
                </ScrollView>
            ) : null}
        </Sheet>
    );
}

function Row({ label, value, big }) {
    const { text, muted } = useBrand();
    return (
        <View style={{ flexDirection: 'row', paddingVertical: 2 }}>
            <Text style={{ color: big ? text : muted, fontWeight: big ? '900' : '700', fontSize: big ? 17 : 14, flex: 1 }}>{label}</Text>
            <Text style={{ color: text, fontWeight: '900', fontSize: big ? 19 : 14 }}>{value}</Text>
        </View>
    );
}
