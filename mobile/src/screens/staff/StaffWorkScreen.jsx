// "My work": a cook's or a waiter's own numbers, what the cook is making now, and their leaves and days off with the owner's answers.
// The Home tab stays clean: only the orders. Reloads when the owner answers a leave (the live message) and whenever the tab is opened.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Pill, Row, SectionTitle, Stat, Empty, Button } from '../../components/owners/ui';
import { StaffHeader, JobBadge, StaffSkeleton } from '../../components/staff/staffBits';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { fetchMyWork, cancelLeave, removeDayOff } from '../../api/staff/staffApi';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { istToday } from '../../utils/owners/txRules';
import { onKitchenUpdate, onWaiterUpdate } from '../../api/common/socket';
import { LEAVE_PILL, range } from '../owners/OwnerStaffPersonScreen';
import { ago } from '../../utils/owners/riderRules';
import { tr } from '../../i18n';

export default function StaffWorkScreen() {
    const { background, text, muted, ok, warn, error, primary } = useBrand();
    const role = useStaffStore((s) => s.me?.role);
    const [d, setD] = useState(null);
    const [failed, setFailed] = useState(false);
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => fetchMyWork().then((r) => { setD(r); setFailed(false); }).catch(() => setFailed(true)), []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => {
        const sub = role === 'waiter' ? onWaiterUpdate : onKitchenUpdate;
        return sub((p) => { if (p?.leave) load(); });   // the owner answered a leave: it shows here now
    }, [role, load]);
    const pull = async () => { setBusy(true); await load(); setBusy(false); };
    const today = istToday();
    const takeBack = async (l) => {
        if (!(await ask({ title: tr('Cancel this leave?'), message: tr('You will be on duty on those days again. The owner is told.'), confirmText: tr('Cancel leave'), cancelText: tr('Keep it'), destructive: true }))) return;
        try { await cancelLeave(l.id); showToast(tr('Leave cancelled')); load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not cancel. Try again.')); }
    };
    const dropDay = async (h) => {
        try { await removeDayOff(h.id); showToast(tr('Day off removed')); load(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not remove it. Try again.')); }
    };

    const cook = role === 'kitchen';
    const tone = { warn, ok, error, muted };
    const s = d?.stats;
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <StaffHeader title={tr('My work')} right={role ? <JobBadge role={role} /> : null} />
            {!d && !failed ? <StaffSkeleton /> : null}
            {failed && !d ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={tr('Pull down to try again.')} /> : null}
            {d ? (
                <ScrollView contentContainerStyle={{ paddingBottom: 120 }} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={busy} onRefresh={pull} tintColor={primary} colors={[primary]} />}>
                    <SectionTitle title={tr(cook ? 'What I made' : 'What I served')} />
                    <Card>
                        <View style={{ flexDirection: 'row' }}>
                            <Stat label={tr('Today')} value={String(s.today.orders)} hint={`${s.today.dishes} ${tr('dishes')}`} />
                            <Stat label={tr('This week')} value={String(s.week.orders)} hint={`${s.week.dishes} ${tr('dishes')}`} />
                            <Stat label={tr(cook ? 'Avg cooking' : 'Avg wait')} value={s.avgMin != null ? `${s.avgMin} ${tr('min')}` : '—'} hint={tr(cook ? 'start to ready' : 'ready to served')} />
                        </View>
                        {!cook ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 10 }}>{tr('Tables served today: {n}', { n: s.tables })}</Text> : null}
                    </Card>

                    {cook ? (
                        <>
                            <SectionTitle title={tr('Making now')} />
                            {d.working.length ? (
                                <Card>
                                    {d.working.map((o, i) => (
                                        <Row key={o.id} icon="flame" title={tr('Order #{orderNo}', { orderNo: o.orderNo })} subtitle={`${o.orderType === 'dine_in' ? tr('Table {n}', { n: o.table || '' }) : o.orderType === 'pickup' ? tr('Pickup') : tr('Delivery')} · ${o.dishes} ${tr('dishes')} · ${ago(o.since)}`} last={i === d.working.length - 1} />
                                    ))}
                                </Card>
                            ) : <Card><Text style={{ color: muted }}>{tr('Nothing on the stove right now.')}</Text></Card>}
                        </>
                    ) : null}

                    <SectionTitle title={tr('My leave and days off')} />
                    <Card>
                        {!d.leaves.length && !d.holidays.length ? <Text style={{ color: muted }}>{tr('No leave asked for yet. You can ask for leave on the Profile tab, under Working time.')}</Text> : null}
                        {d.leaves.map((l, i) => (
                            <View key={l.id} style={{ paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: muted + '55' }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ color: text, fontWeight: '800', flex: 1 }}>{range(l.from, l.to)} · {l.days} {l.days === 1 ? tr('day') : tr('days')}</Text>
                                    <Pill label={tr(LEAVE_PILL[l.status]?.[0] || l.status)} color={tone[LEAVE_PILL[l.status]?.[1]] || muted} />
                                </View>
                                {l.reason ? <Text style={{ color: muted, marginTop: 2 }}>{l.reason}</Text> : null}
                                {l.note ? <Text style={{ color: muted, marginTop: 2, fontStyle: 'italic' }}>{tr('The owner said')}: {l.note}</Text> : null}
                                {['pending', 'approved'].includes(l.status) && l.to >= today ? <View style={{ marginTop: 8 }}><Button label={tr('Cancel this leave')} icon="close-circle" kind="ghost" onPress={() => takeBack(l)} /></View> : null}
                            </View>
                        ))}
                        {d.holidays.filter((h) => !h.leave).map((h) => (
                            <View key={h.id} style={{ paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: muted + '55' }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{range(h.from, h.to)} · {h.days} {h.days === 1 ? tr('day') : tr('days')} <Text style={{ color: muted, fontWeight: '600' }}>({tr('day off I set')})</Text></Text>
                                {h.note ? <Text style={{ color: muted, marginTop: 2 }}>{h.note}</Text> : null}
                                <View style={{ marginTop: 8 }}><Button label={tr('Remove this day off')} icon="close-circle" kind="ghost" onPress={() => dropDay(h)} /></View>
                            </View>
                        ))}
                    </Card>
                </ScrollView>
            ) : null}
        </View>
    );
}
