// Leave requests of the delivery team, for the owner.
//   <LeavePanel />                 all riders: the requests waiting, with Approve / Reject (Riders tab)
//   <LeavePanel riderId="..." />   one rider: his requests and the days he has taken this month (his page)
import React, { useCallback, useState } from 'react';
import { View, Text, Alert, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { Card, SectionTitle, Button, Pill } from './ui';
import { LineShimmer } from './shimmer';
import { fetchLeaves, decideLeave, removeRiderLeave, apiError } from '../../api/owners/shopApi';
import { useRidersStore } from '../../store/owners/useRidersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const nice = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); return `${WEEK[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const range = (a, b) => (a === b ? nice(a) : `${nice(a)} to ${nice(b)}`);

export function LeavePanel({ riderId, monthDays }) {
    const { text, muted, border, ok, error, warn } = useBrand();
    const [items, setItems] = useState(null);
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try {
            const r = await fetchLeaves('all');
            setItems(riderId ? r.items.filter((l) => l.riderId === String(riderId)) : r.items);
        } catch (e) { setItems((x) => x || []); }
    }, [riderId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
    const takeAway = (l) => Alert.alert(tr('Take this leave away?'), tr('{name} will be told and will be on duty on those days.', { name: l.riderName || tr('The delivery partner') }), [
        { text: tr('No'), style: 'cancel' },
        { text: tr('Take it away'), style: 'destructive', onPress: async () => {
            setBusy(l.id);
            try { await removeRiderLeave(l.id); showToast(tr('Leave taken away')); await load(); useRidersStore.getState().load?.(); }
            catch (e) { showToast(apiError(e)); load(); } finally { setBusy(''); }
        } },
    ]);

    const decide = async (l, approve) => {
        setBusy(l.id + approve);
        try {
            await decideLeave(l.id, { approve });
            showToast(approve ? tr('Leave approved') : tr('Leave rejected'));
            await load();
            useRidersStore.getState().load?.();
        } catch (e) {
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
            load();
        } finally { setBusy(''); }
    };

    const pending = (items || []).filter((l) => l.status === 'pending');
    const decided = (items || []).filter((l) => l.status !== 'pending').slice(0, riderId ? 8 : 4);
    if (items && !pending.length && !decided.length && !riderId) return null;   // nothing to show on the Riders tab
    const tone = { approved: [tr('Approved'), ok], rejected: [tr('Rejected'), error], cancelled: [tr('Cancelled'), muted] };

    return (
        <View>
            <SectionTitle title={riderId ? tr('Leave') : tr('Leave requests')} />
            <Card tone={pending.length ? warn : undefined}>
                {riderId ? (
                    <Text style={{ color: text, fontWeight: '900', fontSize: 15, marginBottom: 2 }}>
                        {monthDays ? `${monthDays} ${monthDays === 1 ? tr('day') : tr('days')} ${tr('of leave this month')}` : tr('No leave taken this month')}
                    </Text>
                ) : null}
                {items === null ? <LineShimmer width={180} height={14} /> : null}
                {items && !pending.length && !decided.length ? <Text style={{ color: muted, fontSize: 13 }}>{tr('No leave requests yet.')}</Text> : null}
                {pending.map((l, i) => (
                    <View key={l.id} style={{ paddingTop: i || riderId ? 12 : 0, marginTop: i || riderId ? 12 : 0, borderTopWidth: i || riderId ? 1 : 0, borderTopColor: alpha(border, 0.7) }}>
                        {!riderId ? <Text style={{ color: text, fontWeight: '900' }}>{l.riderName || tr('Delivery partner')}</Text> : null}
                        <Text style={{ color: text, fontWeight: '800', marginTop: riderId ? 0 : 2 }}>{range(l.from, l.to)} · {l.days} {l.days === 1 ? tr('day') : tr('days')}</Text>
                        {l.reason ? <Text style={{ color: muted, fontSize: 13, marginTop: 3 }}>{l.reason}</Text> : null}
                        <View style={{ flexDirection: 'row', marginTop: 10 }}>
                            <Button label={tr('Reject')} icon="close" iconOnly kind="ghost" disabled={!!busy} busy={busy === l.id + false} onPress={() => decide(l, false)} style={{ width: 54 }} />
                            <Button label={tr('Approve')} icon="checkmark" disabled={!!busy} busy={busy === l.id + true} onPress={() => decide(l, true)} style={{ flex: 1, marginLeft: 8 }} />
                        </View>
                    </View>
                ))}
                {decided.map((l) => {
                    const [label, color] = tone[l.status] || tone.cancelled;
                    return (
                        <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                            <View style={{ flex: 1 }}>
                                {!riderId ? <Text style={{ color: text, fontWeight: '800' }} numberOfLines={1}>{l.riderName || tr('Delivery partner')}</Text> : null}
                                <Text style={{ color: muted, fontSize: 12.5 }}>{range(l.from, l.to)} · {l.days} {l.days === 1 ? tr('day') : tr('days')}</Text>
                            </View>
                            {l.status === 'approved' && l.to >= today ? (
                                <Pressable onPress={() => takeAway(l)} disabled={!!busy} hitSlop={8} style={{ marginRight: 10 }}>
                                    <Text style={{ color: error, fontWeight: '800', fontSize: 12.5 }}>{tr('Take away')}</Text>
                                </Pressable>
                            ) : null}
                            <Pill label={label} color={color} />
                        </View>
                    );
                })}
            </Card>
        </View>
    );
}
