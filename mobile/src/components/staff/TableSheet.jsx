// One table's bill for the waiter: every round with its dishes and state, what is left to pay, and (when the shop allows it) the buttons to say the
// money was taken by cash or UPI. A dish that is not served yet stops the payment, with the reason on screen.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Sheet, Pill, money } from '../owners/ui';
import { ListShimmer } from '../owners/shimmer';
import { BigButton } from './staffBits';
import PayQrSheet from './PayQrSheet';
import PartyPickSheet from '../owners/PartyPickSheet';
import { fetchTableBill, waiterSettle, waiterMoveRound, waiterMergeBills, waiterSettleShare } from '../../api/staff/staffApi';
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
    const [qrOpen, setQrOpen] = useState(false);
    const [shareOf, setShareOf] = useState(null);   // one guest's share is being taken: { userId, name, due }
    const [moving, setMoving] = useState(null);   // { kind: 'move', round } | { kind: 'merge' }: choosing the other bill
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

    const paidByQr = async () => {
        setBusy('upi');
        try { await waiterSettle(session.sessionId, 'upi'); setQrOpen(false); showToast(tr('Table {n} is paid.', { n: bill.table })); onPaid(); } catch (e) { showToast(apiError(e)); load(); } finally { setBusy(''); }
    };

    // shared tables: a round on the wrong bill, or two bills that are one group
    const choose = async (p) => {
        const m = moving; setMoving(null);
        const what = m.kind === 'merge' ? tr('Put all of Bill {a} on Bill {b}?', { a: bill.label || '', b: p.label }) : tr('Move this round to Bill {b}?', { b: p.label });
        const yes = await ask({ title: what, message: m.kind === 'merge' ? tr('They become one bill. This bill closes.') : tr('The money is not touched. Only the bill changes.'), confirmText: tr('Yes'), cancelText: tr('Go back') });
        if (!yes) return;
        try {
            if (m.kind === 'merge') await waiterMergeBills(session.sessionId, p.sessionId); else await waiterMoveRound(m.round.id, p.sessionId);
            showToast(tr('Done'));
            if (m.kind === 'merge') onPaid(); else load();
        } catch (e) { showToast(apiError(e)); load(); }
    };
    const sib = (bill?.siblings || []).map((x) => ({ ...x, sub: null }));
    // one guest pays his own share and leaves; the others stay on the bill
    const payShare = async (method) => {
        setBusy('share' + method);
        try {
            const r = await waiterSettleShare(session.sessionId, shareOf.userId, method);
            showToast(tr('{name} paid and left', { name: shareOf.name || tr('The guest') }));
            setShareOf(null);
            if (r.closed) onPaid(); else load();
        } catch (e) { showToast(apiError(e)); load(); } finally { setBusy(''); }
    };
    const people = (bill?.shares || []).filter((x) => x.due > 0);

    const unserved = bill?.rounds?.some((r) => r.status !== 'delivered');
    return (
        <Sheet visible={!!session} onClose={onClose} title={session ? (tr('Table {n}', { n: session.table }) + (bill?.label ? ` · ${bill.label}` : '')) : ''}>
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
                                            <Text style={{ color: text, fontWeight: '900', flex: 1 }} numberOfLines={1}>#{r.orderNo}{r.by?.name ? ` · ${r.by.name}` : ''}</Text>
                                            <Pill label={tr(label)} color={c} />
                                            <Text style={{ color: text, fontWeight: '900', marginLeft: 10, minWidth: 64, textAlign: 'right' }}>{money(r.total)}{r.paid ? ' ✓' : ''}</Text>
                                        </View>
                                        {r.paid ? <Text style={{ color: ok, fontWeight: '800', fontSize: 12.5, marginBottom: 2 }}>{tr('Paid')}{r.paidBy?.name ? ` · ${r.paidBy.name}` : ''}{r.paidVia ? ` · ${tr(r.paidVia === 'online' ? 'Online' : r.paidVia === 'upi' ? 'UPI' : 'Cash')}` : ''}</Text> : null}
                                        {sib.length ? <Pressable onPress={() => setMoving({ kind: 'move', round: r })} hitSlop={8} style={{ alignSelf: 'flex-start', paddingVertical: 4 }}><Text style={{ color: primary, fontWeight: '800', fontSize: 12.5 }}>{tr('Wrong bill? Move this round')}</Text></Pressable> : null}
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
                            {bill.canSettle && people.length > 1 ? (
                                <View style={{ marginTop: 12 }}>
                                    <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>{tr('A GUEST PAYS HIS OWN SHARE')}</Text>
                                    {people.map((x) => (
                                        <Pressable key={x.userId} onPress={() => setShareOf({ userId: x.userId, name: (x.name || '').split(' ')[0] || null, due: x.due })} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, opacity: pressed ? 0.6 : 1 })}>
                                            <Text style={{ flex: 1, color: text, fontWeight: '800' }} numberOfLines={1}>{x.name || tr('Guest')}</Text>
                                            <Text style={{ color: text, fontWeight: '900', marginRight: 10 }}>{money(x.due)}</Text>
                                            <Text style={{ color: primary, fontWeight: '900' }}>{tr('Take')}</Text>
                                        </Pressable>
                                    ))}
                                </View>
                            ) : null}
                            {sib.length ? <Pressable onPress={() => setMoving({ kind: 'merge' })} hitSlop={8} style={{ alignSelf: 'flex-start', paddingTop: 12 }}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Together with another bill? Merge')}</Text></Pressable> : null}
                            {bill.canSettle ? (
                                <View style={{ marginTop: 14, marginBottom: 6 }}>
                                    <BigButton label={tr('Cash received')} icon="cash" bg={ok} ink="#FFFFFF" busy={busy === 'cash'} disabled={unserved || !!busy || bill.payable <= 0} onPress={() => pay('cash')} />
                                    <View style={{ height: 10 }} />
                                    <BigButton label={tr('UPI received')} icon="phone-portrait" bg={primary} ink="#FFFFFF" busy={busy === 'upi'} disabled={unserved || !!busy || bill.payable <= 0} onPress={() => pay('upi')} />
                                    <View style={{ height: 10 }} />
                                    <BigButton label={tr('Show QR to pay')} icon="qr-code" bg={alpha(primary, 0.14)} ink={primary} disabled={unserved || !!busy || bill.payable <= 0} onPress={() => setQrOpen(true)} />
                                </View>
                            ) : <Text style={{ color: muted, fontWeight: '600', marginTop: 14 }}>{bill.status === 'closed' ? tr('This bill is paid.') : tr('The owner takes the money for this bill.')}</Text>}
                        </View>
                    ) : null}
                </ScrollView>
            ) : null}
            <Sheet visible={!!shareOf} onClose={() => setShareOf(null)} title={shareOf ? tr('{name}: {amount}', { name: shareOf.name || tr('Guest'), amount: money(shareOf.due) }) : ''}>
                <Text style={{ color: muted, marginBottom: 12 }}>{tr('Take only this guest\'s share. He leaves the bill; the others stay.')}</Text>
                <BigButton label={tr('Cash received')} icon="cash" bg={ok} ink="#FFFFFF" busy={busy === 'sharecash'} disabled={!!busy} onPress={() => payShare('cash')} />
                <View style={{ height: 10 }} />
                <BigButton label={tr('UPI received')} icon="phone-portrait" bg={primary} ink="#FFFFFF" busy={busy === 'shareupi'} disabled={!!busy} onPress={() => payShare('upi')} />
            </Sheet>
            <PartyPickSheet visible={!!moving} title={moving?.kind === 'merge' ? tr('Same group as…') : tr('Move to which bill?')} hint={moving?.kind === 'merge' ? tr('Pick the bill these guests are together with.') : null} options={sib} onPick={choose} onClose={() => setMoving(null)} />
            <PayQrSheet visible={qrOpen} sessionId={session?.sessionId} busy={busy === 'upi'} onClose={() => setQrOpen(false)} onPaid={paidByQr} />
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
