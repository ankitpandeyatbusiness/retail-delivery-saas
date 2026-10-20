// "Tell the owner": the cook says what is wrong with an order. A finished dish is switched off on the menu at once. The order itself is left
// as it is: the owner decides (cancel it, wait, change it).
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useBrand } from '../common/kit';
import { Sheet, Option, Field, Button } from '../owners/ui';
import { kitchenProblem } from '../../api/staff/staffApi';
import { apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

export default function ProblemSheet({ order, onClose, onDone }) {
    const { muted } = useBrand();
    const [kind, setKind] = useState('');
    const [dish, setDish] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (order) { setKind(''); setDish(order.items.length === 1 ? order.items[0].productId : ''); setNote(''); } }, [order]);

    const valid = kind === 'out_of_stock' ? !!dish : kind === 'other' ? note.trim().length >= 3 : kind === 'cannot_make';
    const send = async () => {
        setBusy(true);
        try {
            const r = await kitchenProblem(order.id, { kind, ...(kind === 'out_of_stock' ? { productId: dish } : {}), ...(kind === 'other' ? { note: note.trim() } : {}) });
            showToast(r.dishOff ? tr('The owner is told. The dish is switched off.') : tr('The owner is told.'));
            onDone();
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <Sheet visible={!!order} onClose={onClose} title={order ? tr('Order #{n}: tell the owner', { n: order.orderNo }) : ''}>
            {order ? (
                <View>
                    <Option selected={kind === 'out_of_stock'} title={tr('A dish is finished')} subtitle={tr('It is switched off on the menu, and the owner decides about this order')} onPress={() => setKind('out_of_stock')} />
                    {kind === 'out_of_stock' ? (
                        <View style={{ paddingLeft: 36, paddingBottom: 6 }}>
                            {order.items.map((l) => (
                                <Option key={l.productId} selected={dish === l.productId} title={l.name} onPress={() => setDish(l.productId)} last />
                            ))}
                        </View>
                    ) : null}
                    <Option selected={kind === 'cannot_make'} title={tr('I cannot make this order')} subtitle={tr('For any other reason')} onPress={() => setKind('cannot_make')} />
                    <Option selected={kind === 'other'} title={tr('Something else')} onPress={() => setKind('other')} last />
                    {kind === 'other' ? <Field value={note} onChangeText={setNote} placeholder={tr('Write the problem')} maxLength={140} style={{ marginTop: 8 }} /> : null}
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 10, marginBottom: 12 }}>{tr('You cannot cancel an order. The owner is told at once.')}</Text>
                    <Button label={tr('Tell the owner')} icon="send" disabled={!valid} busy={busy} onPress={send} />
                </View>
            ) : null}
        </Sheet>
    );
}
