// One table's bill, and the buttons that take the money. (Its own file, so the Dine in screen and the lists that open it do not import each other.)
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet } from './ui';
import { ListShimmer } from './shimmer';
import BillDetails from './BillDetails';
import { fetchDineBill, settleDineBill, walkoutDineBill, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };

export default function BillSheet({ table, onClose, onDone }) {
    const { text, muted, ok, warn } = useBrand();
    const [bill, setBill] = useState(null);
    const [busy, setBusy] = useState('');
    useEffect(() => { setBill(null); if (table?.sessionId) fetchDineBill(table.sessionId).then(setBill).catch((e) => showToast(apiError(e))); }, [table?.sessionId]);
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
        <Sheet visible={!!table} onClose={onClose} title={table ? tr('Table {t} bill', { t: table.table }) : ''}>
            {!bill ? <ListShimmer count={1} rows /> : (
                <View>
                    {bill.status === 'bill_asked' ? <Text style={{ color: warn, fontWeight: '900', marginBottom: 8 }}>{tr('The customer asked for the bill')}</Text> : null}
                    {bill.nudgeAt && Date.now() - new Date(bill.nudgeAt).getTime() < 10 * 60000 ? <Text style={{ color: warn, fontWeight: '900', marginBottom: 6 }}>{tr('They asked the kitchen to hurry at {time}', { time: hm(bill.nudgeAt) })}</Text> : null}
                    <BillDetails bill={bill} />
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
        </Sheet>
    );
}
