// One cook or waiter, like a rider's page: who they are, how to reach them, what they did, what they are making now, their leaves and days off,
// and pausing or removing them. Opened with params { userId }.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Row, Sheet, Field, SectionTitle, Empty, Stat } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { callPhone, whatsApp } from '../../components/owners/orderBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { PersonAvatar, DutyPills } from './OwnerStaffGroupScreen';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { fetchStaffPerson, updateStaff, removeStaff, removeStaffLeave, removeStaffHoliday, apiError } from '../../api/owners/shopApi';
import { istToday } from '../../utils/owners/txRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ago } from '../../utils/owners/riderRules';
import { tr } from '../../i18n';

export const LEAVE_PILL = { pending: ['Waiting', 'warn'], approved: ['Approved', 'ok'], rejected: ['Not approved', 'error'], cancelled: ['Cancelled', 'muted'] };
export const range = (a, b) => (a === b ? a : `${a} → ${b}`);

export default function OwnerStaffPersonScreen() {
    const nav = useNavigation();
    const { userId } = useRoute().params || {};
    const { background, text, muted, ok, warn, error } = useBrand();
    const access = useOwnerStore((st) => st.access);
    const [d, setD] = useState(null);
    const [gone, setGone] = useState(false);
    const [nameOpen, setNameOpen] = useState(false);
    const [name, setName] = useState('');
    const [busy, setBusy] = useState(false);
    const load = useCallback(() => fetchStaffPerson(userId).then((r) => { setD(r); setGone(false); }).catch((e) => { if (e?.response?.status === 404) setGone(true); else useOwnerStore.getState().noteError(e); }), [userId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const p = d?.person;
    if (!p) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Staff')} />
                {gone ? <Empty icon="person-outline" title={tr('Not found')} hint={tr('They may have been removed.')} /> : <ListShimmer />}
            </View>
        );
    }
    const cook = p.role === 'kitchen';
    const tone = { warn, ok, error, muted };
    const setActive = async (v) => {
        setD((x) => ({ ...x, person: { ...x.person, isActive: v } }));
        try { await updateStaff(userId, { isActive: v }); showToast(v ? tr('Switched on') : tr('Switched off')); load(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); load(); }
    };
    const saveName = async () => {
        setBusy(true);
        try { await updateStaff(userId, { name: name.trim() }); setNameOpen(false); showToast(tr('Saved')); load(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    const remove = async () => {
        const yes = await ask({ title: tr('Remove {name}?', { name: p.name || p.phone }), message: tr('They are logged out at once and lose access to the shop screens. Their history is kept. You can add them again later.'), confirmText: tr('Remove'), destructive: true });
        if (!yes) return;
        try { await removeStaff(userId); showToast(tr('Removed')); nav.goBack(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };
    const s = d.stats;
    const takeLeaveBack = async (l) => {
        if (!(await ask({ title: tr('Take this leave away?'), message: tr('{from} is on duty on those days again. {name} is told.', { from: range(l.from, l.to), name: p.name || p.phone }), confirmText: tr('Take it away'), destructive: true }))) return;
        try { await removeStaffLeave(l.id); showToast(tr('Leave removed. They are told.')); load(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };
    const takeDayOffBack = async (h) => {
        if (!(await ask({ title: tr('Remove this day off?'), message: tr('{name} is on duty on those days again and is told.', { name: p.name || p.phone }), confirmText: tr('Remove'), destructive: true }))) return;
        try { await removeStaffHoliday(userId, h.id); showToast(tr('Day off removed. They are told.')); load(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };
    const today = istToday();

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={p.name || p.phone} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <PersonAvatar person={p} size={56} />
                        <View style={{ flex: 1, marginLeft: 14, minWidth: 0 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 18 }} numberOfLines={1}>{p.name || tr('No name yet')}</Text>
                            <Text style={{ color: muted, marginTop: 2 }}>{p.phone}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                <Pill label={tr(cook ? 'Kitchen' : 'Waiter')} icon={cook ? 'flame' : 'restaurant'} />
                                <View style={{ marginLeft: 6 }}><DutyPills p={{ ...p, duty: d.duty.status }} /></View>
                            </View>
                        </View>
                    </View>
                    {p.lastSeenAt ? <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('Last seen {ago}', { ago: ago(p.lastSeenAt) })}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <View style={{ flex: 1, marginRight: 6 }}><Button label={tr('Call')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(p.phone)} /></View>
                        <View style={{ flex: 1, marginLeft: 6 }}><Button label={tr('WhatsApp')} icon="logo-whatsapp" iconOnly kind="ghost" onPress={() => whatsApp(p.phone)} /></View>
                    </View>
                </Card>

                <SectionTitle title={tr(cook ? 'What they made' : 'What they served')} />
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
                                    <Row key={o.id} icon="flame" title={tr('Order #{orderNo}', { orderNo: o.orderNo })} subtitle={`${o.orderType === 'dine_in' ? tr('Table {n}', { n: o.table || '' }) + (o.party ? ' · ' + o.party : '') : o.orderType === 'pickup' ? tr('Pickup') : tr('Delivery')} · ${o.dishes} ${tr('dishes')} · ${ago(o.since)}`} last={i === d.working.length - 1} onPress={() => nav.navigate('OwnerOrder', { id: o.id })} />
                                ))}
                            </Card>
                        ) : <Card><Text style={{ color: muted }}>{tr('Nothing on the stove right now.')}</Text></Card>}
                    </>
                ) : null}

                <SectionTitle title={tr('Leave and days off')} />
                <Card>
                    {!d.leaves.length && !d.holidays.length ? <Text style={{ color: muted }}>{tr('No leave asked for and no days off yet.')}</Text> : null}
                    {d.leaves.map((l, i) => (
                        <View key={l.id} style={{ paddingVertical: 8, borderTopWidth: i ? 0.5 : 0, borderTopColor: muted + '55' }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <Text style={{ color: text, fontWeight: '800', flex: 1 }}>{range(l.from, l.to)} · {l.days} {l.days === 1 ? tr('day') : tr('days')}</Text>
                                <Pill label={tr(LEAVE_PILL[l.status]?.[0] || l.status)} color={tone[LEAVE_PILL[l.status]?.[1]] || muted} />
                            </View>
                            {l.reason ? <Text style={{ color: muted, marginTop: 2 }}>{l.reason}</Text> : null}
                            {l.note ? <Text style={{ color: muted, marginTop: 2, fontStyle: 'italic' }}>{tr('You said')}: {l.note}</Text> : null}
                            {['pending', 'approved'].includes(l.status) && l.to >= today ? <View style={{ marginTop: 8 }}><Button label={tr('Take this leave away')} icon="close-circle" kind="danger" onPress={() => takeLeaveBack(l)} /></View> : null}
                        </View>
                    ))}
                    {d.holidays.filter((h) => !h.leave).map((h) => (
                        <View key={h.id} style={{ paddingVertical: 8, borderTopWidth: 0.5, borderTopColor: muted + '55' }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{range(h.from, h.to)} · {h.days} {h.days === 1 ? tr('day') : tr('days')} <Text style={{ color: muted, fontWeight: '600' }}>({tr('day off they set')})</Text></Text>
                            {h.note ? <Text style={{ color: muted, marginTop: 2 }}>{h.note}</Text> : null}
                            <View style={{ marginTop: 8 }}><Button label={tr('Remove this day off')} icon="close-circle" kind="danger" onPress={() => takeDayOffBack(h)} /></View>
                        </View>
                    ))}
                </Card>

                <SectionTitle title={tr('Staff')} />
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{tr('Can work')}</Text>
                            <Text style={{ color: muted, fontSize: 12 }}>{tr('Switch off to stop their alerts and screen. Their history stays.')}</Text>
                        </View>
                        <Toggle value={p.isActive} onValueChange={setActive} disabled={access !== 'ok' && access !== 'paused'} />
                    </View>
                    <View style={{ marginTop: 12 }}><Button label={tr('Change name')} icon="create" kind="ghost" onPress={() => { setName(p.name || ''); setNameOpen(true); }} /></View>
                    <View style={{ marginTop: 10 }}><Button label={tr('Remove from staff')} icon="trash" kind="danger" onPress={remove} /></View>
                </Card>
            </ScrollView>
            <Sheet visible={nameOpen} onClose={() => setNameOpen(false)} title={tr('Name')}>
                <Field value={name} onChangeText={setName} placeholder={tr('Name')} maxLength={40} style={{ marginBottom: 14 }} />
                <Button label={tr('Save')} icon="checkmark" disabled={name.trim().length < 1} busy={busy} onPress={saveName} />
            </Sheet>
        </View>
    );
}
