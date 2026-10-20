// Under the tables: what guests are waiting for, oldest first. A call (water, waiter...) is closed with Done; a table that asked for the
// bill opens its bill. Also: what guests told the owner privately after their meal.
import React, { useCallback, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button, Card, SectionTitle } from './ui';
import WaitTimer from '../common/WaitTimer';
import BillSheet from './BillSheet';
import { fetchTableRequests, doneTableRequest, fetchTableFeedback, seenTableFeedback, apiError } from '../../api/owners/shopApi';
import { onNotification, onOrderUpdate } from '../../api/common/socket';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const ICON = { waiter: 'hand-left', water: 'water', cutlery: 'restaurant', clean: 'sparkles', other: 'help-circle', bill: 'receipt' };

export default function TableRequests() {
    const { text, muted, warn, primary } = useBrand();
    const enabled = !!useHomeStore((st) => st.full.orders.dineIn?.enabled);
    const [items, setItems] = useState([]);
    const [open, setOpen] = useState(null);
    const load = useCallback(() => { fetchTableRequests().then((r) => setItems(r.items || [])).catch(() => { }); }, []);
    useFocusEffect(useCallback(() => {
        load();
        if (!enabled) return undefined;
        const t = setInterval(load, 15000);
        const a = onNotification((n) => { if (n?.type === 'table_call' || n?.type === 'table_bill_asked') load(); });
        const b = onOrderUpdate(load);
        return () => { clearInterval(t); a(); b(); };
    }, [enabled, load]));
    if (!items.length) return null;
    const done = async (id) => {
        setItems((l) => l.filter((x) => x.id !== id));
        try { await doneTableRequest(id); } catch (e) { showToast(apiError(e)); load(); }
    };
    return (
        <View>
            <SectionTitle title={tr('Calls and bill requests')} />
            {items.map((x) => (
                <Card key={x.id}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(x.type === 'bill' ? warn : primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name={ICON[x.kind] || 'help-circle'} size={20} color={x.type === 'bill' ? warn : primary} />
                        </View>
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Table {t}', { t: x.table })} · {tr(x.label)}</Text>
                            {x.text ? <Text style={{ color: text, fontWeight: '800', marginTop: 2 }}>“{x.text}”</Text> : null}
                            <WaitTimer since={x.at} style={{ marginTop: 3 }} />
                        </View>
                        {x.type === 'call'
                            ? <Button label={tr('Done')} icon="checkmark" kind="ghost" onPress={() => done(x.id)} style={{ minWidth: 104 }} />
                            : <Button label={tr('Open bill')} icon="receipt" kind="ghost" onPress={() => setOpen({ sessionId: x.sessionId, table: x.table })} style={{ minWidth: 118 }} />}
                    </View>
                </Card>
            ))}
            <BillSheet table={open} onClose={() => setOpen(null)} onDone={load} />
        </View>
    );
}

// what guests told the owner, privately
export function GuestFeedback() {
    const { text, muted, error, ok } = useBrand();
    const dine = useHomeStore((st) => st.full.orders.dineIn) || {};
    const [data, setData] = useState(null);
    useFocusEffect(useCallback(() => {
        if (!dine.enabled || !dine.feedbackOn) return undefined;
        fetchTableFeedback().then(setData).catch(() => { });
        return undefined;
    }, [dine.enabled, dine.feedbackOn]));
    if (!dine.enabled || !dine.feedbackOn || !data) return null;
    const unseen = data.items.filter((x) => !x.seen).length;
    const markSeen = async () => { try { await seenTableFeedback(); setData((d) => ({ ...d, items: d.items.map((x) => ({ ...x, seen: true })) })); } catch (e) { showToast(apiError(e)); } };
    return (
        <View>
            <SectionTitle title={tr('Guest feedback')} />
            <Card>
                <Text style={{ color: muted, fontSize: 12.5 }}>{data.count ? tr('Average {a} of 5 from {n} guests in the last 30 days. Only you can see this.', { a: data.avg, n: data.count }) : tr('Guests are asked after they pay. Only you can see what they write.')}</Text>
                {data.items.slice(0, 8).map((x) => (
                    <View key={x.id} style={{ marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: alpha(muted, 0.2) }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: x.stars <= 3 ? error : ok, fontWeight: '900', fontSize: 15 }}>{'★'.repeat(x.stars)}<Text style={{ color: alpha(muted, 0.5) }}>{'★'.repeat(5 - x.stars)}</Text></Text>
                            <Text style={{ color: text, fontWeight: '800', marginLeft: 8, flex: 1 }} numberOfLines={1}>{tr('Table {t}', { t: x.table })}{x.name ? ` · ${x.name}` : ''}</Text>
                            {!x.seen ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: error }} /> : null}
                        </View>
                        {x.tags?.length ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{x.tags.map((t) => tr(t)).join(' · ')}</Text> : null}
                        {x.comment ? <Text style={{ color: text, fontWeight: '800', marginTop: 4 }}>{x.comment}</Text> : null}
                    </View>
                ))}
                {unseen ? <Pressable onPress={markSeen} hitSlop={8} style={{ marginTop: 12 }}><Text style={{ color: muted, fontWeight: '800' }}>{tr('Mark all as seen')}</Text></Pressable> : null}
            </Card>
        </View>
    );
}
