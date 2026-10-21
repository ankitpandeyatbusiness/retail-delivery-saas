// One table's bill, and the buttons that take the money. (Its own file, so the Dine in screen and the lists that open it do not import each other.)
import React, { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet } from './ui';
import { ListShimmer } from './shimmer';
import BillDetails from './BillDetails';
import { fetchDineBill, settleDineBill, walkoutDineBill, setOrderStatus, moveRound, mergeBills, settleShare, walkoutShare, apiError } from '../../api/owners/shopApi';
import PartyPickSheet from './PartyPickSheet';
import { ReasonSheet } from './orderBits';
import * as flow from '../../utils/owners/orderFlow';
import { showToast } from '../customers/shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

export default function BillSheet({ table, onClose, onDone }) {
    const { text, muted, ok, warn } = useBrand();
    const [bill, setBill] = useState(null);
    const [busy, setBusy] = useState('');
    const [dropping, setDropping] = useState(null);   // the round the owner is cancelling
    const [dropBusy, setDropBusy] = useState(false);
    const [shareOf, setShareOf] = useState(null);   // one guest: { userId, name, due }
    const [moving, setMoving] = useState(null);   // shared tables: { kind: 'move', round } | { kind: 'merge' }
    useEffect(() => { setBill(null); if (table?.sessionId) fetchDineBill(table.sessionId).then(setBill).catch((e) => showToast(apiError(e))); }, [table?.sessionId]);
    // cancel one round that is still in the kitchen: the guest is told why (the reason, and anything the owner writes)
    const drop = async (code, note) => {
        setDropBusy(true);
        try {
            await setOrderStatus(dropping.id, { status: 'cancelled', reasonCode: code, ...(note ? { note } : {}) });
            showToast(tr('Round cancelled. The guest is told.'));
            setDropping(null);
            try { setBill(await fetchDineBill(table.sessionId)); } catch (e) { onDone(); onClose(); return; }   // the table closed itself: nothing left
            onDone();
        } catch (e) { showToast(apiError(e)); } finally { setDropBusy(false); }
    };
    const choose = async (p) => {
        const m = moving; setMoving(null);
        const yes = await ask({
            title: m.kind === 'merge' ? tr('Put all of Bill {a} on Bill {b}?', { a: bill.label || '', b: p.label }) : tr('Move this round to Bill {b}?', { b: p.label }),
            message: m.kind === 'merge' ? tr('They become one bill. This bill closes.') : tr('The money is not touched. Only the bill changes.'), confirmText: tr('Yes'), cancelText: tr('Go back'),
        });
        if (!yes) return;
        try {
            if (m.kind === 'merge') { await mergeBills(table.sessionId, p.sessionId); showToast(tr('Merged')); onDone(); onClose(); } else { await moveRound(m.round.id, p.sessionId); showToast(tr('Moved')); try { setBill(await fetchDineBill(table.sessionId)); } catch (e) { onDone(); onClose(); return; } onDone(); }
        } catch (e) { showToast(apiError(e)); }
    };
    const sib = bill?.siblings || [];
    const people = (bill?.shares || []).filter((x) => x.due > 0);
    const takeShare = async (method) => {
        setBusy('share' + method);
        try { const r = await settleShare(table.sessionId, shareOf.userId, method); showToast(tr('{name} paid and left', { name: shareOf.name || tr('The guest') })); setShareOf(null); if (r.closed) { onDone(); onClose(); } else { setBill(await fetchDineBill(table.sessionId)); onDone(); } } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const shareLeft = async () => {
        const yes = await ask({ title: tr('{name} left without paying?', { name: shareOf.name || tr('The guest') }), message: tr('Only {amount} becomes a bill he owes. The others keep their own.', { amount: rs(shareOf.due) }), confirmText: tr('Yes, he left'), cancelText: tr('Go back') });
        if (!yes) return;
        setBusy('shareleft');
        try { const r = await walkoutShare(table.sessionId, shareOf.userId); showToast(tr('Noted. {name} owes {amount}', { name: shareOf.name || tr('The guest'), amount: rs(r.owedPaise / 100) })); setShareOf(null); if (r.closed) { onDone(); onClose(); } else { setBill(await fetchDineBill(table.sessionId)); onDone(); } } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const settle = async (method) => {
        if (bill.kitchenBusy) { showToast(tr('Serve the dishes in the kitchen first')); return; }
        setBusy(method);
        try { await settleDineBill(table.sessionId, method); showToast(tr('Table {t} is paid and free again', { t: table.table })); onDone(); onClose(); } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    const leave = async () => {
        if (bill.kitchenBusy) { showToast(tr('Serve the dishes in the kitchen first')); return; }
        const yes = await ask({ title: tr('He left without paying?'), message: tr('The table is closed and the amount stays owed. He cannot start a new tab here until he pays it.'), confirmText: tr('Yes, he left'), cancelText: tr('No') });
        if (!yes) return;
        setBusy('leave');
        try { await walkoutDineBill(table.sessionId); showToast(tr('Noted. The amount is kept in Unpaid bills')); onDone(); onClose(); } catch (e) { showToast(apiError(e)); } finally { setBusy(''); }
    };
    return (
        <Sheet visible={!!table} onClose={onClose} title={table ? (tr('Table {t} bill', { t: table.table }) + (bill?.label ? ` · ${bill.label}` : '')) : ''}>
            {!bill ? <ListShimmer count={1} rows /> : (
                <View>
                    {bill.status === 'bill_asked' ? <Text style={{ color: warn, fontWeight: '900', marginBottom: 8 }}>{tr('The customer asked for the bill')}</Text> : null}
                    {bill.nudgeAt && Date.now() - new Date(bill.nudgeAt).getTime() < 10 * 60000 ? <Text style={{ color: warn, fontWeight: '900', marginBottom: 6 }}>{tr('They asked the kitchen to hurry at {time}', { time: hm(bill.nudgeAt) })}</Text> : null}
                    <BillDetails bill={bill} />
                    {(table?.watch || []).length ? (
                        <View style={{ marginBottom: 8, padding: 10, borderRadius: 12, backgroundColor: alpha(warn, 0.14) }}>
                            {table.watch.map((x) => <Text key={x.userId} style={{ color: text, fontWeight: '800', fontSize: 13 }}>{x.name || tr('A guest')}: {x.state === 'location_off' ? tr('location is off') : tr('phone is not reachable')}</Text>)}
                            <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Keep an eye on this table.')}</Text>
                        </View>
                    ) : null}
                    {people.length > 1 ? (
                        <View style={{ marginBottom: 8 }}>
                            <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 2 }}>{tr('EACH GUEST')}</Text>
                            {people.map((x) => (
                                <Pressable key={x.userId} onPress={() => setShareOf({ userId: x.userId, name: (x.name || '').split(' ')[0] || null, due: x.due })} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                                    <Text style={{ flex: 1, color: text, fontWeight: '700' }} numberOfLines={1}>{x.name || tr('Guest')}</Text>
                                    <Text style={{ color: text, fontWeight: '900', marginRight: 10 }}>{rs(x.due)}</Text>
                                    <Text style={{ color: ok, fontWeight: '900' }}>{tr('Take share')}</Text>
                                </Pressable>
                            ))}
                        </View>
                    ) : null}
                    {sib.length ? (
                        <View style={{ marginBottom: 8 }}>
                            {bill.rounds.filter((r) => !['cancelled', 'undelivered'].includes(r.status)).map((r) => (
                                <Pressable key={r.id} onPress={() => setMoving({ kind: 'move', round: r })} hitSlop={6} style={{ paddingVertical: 4 }}><Text style={{ color: muted, fontSize: 12.5 }}>#{r.orderNo} · <Text style={{ color: text, fontWeight: '800' }}>{tr('Move to another bill')}</Text></Text></Pressable>
                            ))}
                            <Pressable onPress={() => setMoving({ kind: 'merge' })} hitSlop={6} style={{ paddingTop: 8 }}><Text style={{ color: warn, fontWeight: '900' }}>{tr('Together with another bill? Merge')}</Text></Pressable>
                        </View>
                    ) : null}
                    {bill.rounds.some((r) => ['placed', 'accepted', 'preparing', 'ready'].includes(r.status)) ? (
                        <View style={{ marginBottom: 8 }}>
                            <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>{tr('STILL IN THE KITCHEN')}</Text>
                            {bill.rounds.filter((r) => ['placed', 'accepted', 'preparing', 'ready'].includes(r.status)).map((r) => (
                                <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                                    <Text style={{ flex: 1, color: text }} numberOfLines={1}>#{r.orderNo} · {r.summary} · {rs(r.total)}{r.asked ? ` · ${tr('asked to cancel')}` : ''}</Text>
                                    <Pressable onPress={() => setDropping(r)} hitSlop={8}><Text style={{ color: warn, fontWeight: '900' }}>{tr('Cancel')}</Text></Pressable>
                                </View>
                            ))}
                        </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', paddingTop: 8, borderTopWidth: 1, borderTopColor: alpha(muted, 0.3) }}>
                        <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 17 }}>{tr('To collect')}</Text>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 20 }}>{rs(bill.payable ?? bill.due)}</Text>
                    </View>
                    {bill.tip > 0 ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 4 }}>{tr('Includes a tip of {t} for the waiter', { t: rs(bill.tip) })}</Text> : null}
                    {bill.kitchenBusy ? <Text style={{ color: warn, fontSize: 12.5, marginTop: 8 }}>{tr('Some dishes are still in the kitchen. Serve them before you take the payment.')}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: 14 }}>
                        <Button label={tr('Cash Paid')} icon="cash" busy={busy === 'cash'} disabled={!!busy} onPress={() => settle('cash')} style={{ flex: 1, marginRight: 8 }} />
                        <Button label={tr('Online Paid')} icon="card" busy={busy === 'upi'} disabled={!!busy} onPress={() => settle('upi')} style={{ flex: 1 }} />
                    </View>
                    <Button label={tr('He left without paying')} icon="walk" kind="ghost" disabled={!!busy} onPress={leave} style={{ marginTop: 10 }} />
                </View>
            )}
            <Sheet visible={!!shareOf} onClose={() => setShareOf(null)} title={shareOf ? `${shareOf.name || tr('Guest')}: ${rs(shareOf.due)}` : ''}>
                <Text style={{ color: muted, marginBottom: 12 }}>{tr('Take only this guest\'s share. He leaves the bill; the others stay.')}</Text>
                <View style={{ flexDirection: 'row' }}>
                    <Button label={tr('Cash Paid')} icon="cash" busy={busy === 'sharecash'} disabled={!!busy} onPress={() => takeShare('cash')} style={{ flex: 1, marginRight: 8 }} />
                    <Button label={tr('Online Paid')} icon="card" busy={busy === 'shareupi'} disabled={!!busy} onPress={() => takeShare('upi')} style={{ flex: 1 }} />
                </View>
                <Button label={tr('He left without paying')} icon="walk" kind="ghost" busy={busy === 'shareleft'} disabled={!!busy} onPress={shareLeft} style={{ marginTop: 10 }} />
            </Sheet>
            <PartyPickSheet visible={!!moving} title={moving?.kind === 'merge' ? tr('Same group as…') : tr('Move to which bill?')} hint={moving?.kind === 'merge' ? tr('Pick the bill these guests are together with.') : null} options={sib} onPick={choose} onClose={() => setMoving(null)} />
            <ReasonSheet
                visible={!!dropping}
                title={dropping ? tr('Cancel order #{n}', { n: dropping.orderNo }) : ''}
                intro={tr('Choose a reason. The guest is told, and you can add your own words.')}
                reasons={flow.DINE_CANCEL_REASONS}
                needsText="other"
                textLabel={tr('Write the reason')}
                submitLabel={tr('Cancel this round')}
                busy={dropBusy}
                onClose={() => setDropping(null)}
                onSubmit={drop}
            />
        </Sheet>
    );
}
