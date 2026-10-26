// Kitchen staff / Waiters: the team of one job, laid out like the Riders page. A summary on top (who is on duty, what they did today and this week),
// leave requests, then every person: tap one for their page. The owner adds, pauses or removes people here too.
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Image } from 'expo-image';
import { useBrand, alpha } from '../../components/common/kit';
import { Card, Pill, Button, Empty, SectionTitle, Stat, Chips } from '../../components/owners/ui';
import { FormPage, Toggle } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { AddSheet, LeaveRequests } from './OwnerStaffScreen';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { fetchStaff, updateStaff, saveSettings, fetchSettings, apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { tr } from '../../i18n';

const JOB = {
    kitchen: { title: 'Kitchen staff', one: 'cook', many: 'cooks', icon: 'flame', did: 'Made today', didWeek: 'Made this week', unit: 'orders', avg: 'Average cooking time', none: 'Add a cook with their mobile number. They sign in with an OTP and see the kitchen screen.' },
    waiter: { title: 'Waiters', one: 'waiter', many: 'waiters', icon: 'restaurant', did: 'Served today', didWeek: 'Served this week', unit: 'orders', avg: 'Average wait of a ready dish', none: 'Add a waiter with their mobile number. They sign in with an OTP and see the floor screen.' },
};

export const dutyWords = (p) => (p.duty === 'holiday' ? 'Day off' : p.duty === 'outside' ? 'Outside hours' : p.duty === 'shop_closed' ? 'Shop closed' : 'Off duty');

export function PersonAvatar({ person, size = 44 }) {
    const { primary } = useBrand();
    if (person?.photo) return <Image source={{ uri: person.photo }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(primary, 0.16) }} contentFit="cover" />;
    return (
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(primary, 0.16), alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: primary, fontWeight: '900', fontSize: size * 0.42 }}>{(person?.name || person?.phone || '?').charAt(0).toUpperCase()}</Text>
        </View>
    );
}

export function DutyPills({ p }) {
    const { ok, warn, muted } = useBrand();
    if (!p.isActive) return <Pill label={tr('Switched off')} color={muted} />;
    if (p.duty === 'on') return <Pill label={tr('On duty')} color={ok} icon="radio-button-on" />;
    return <Pill label={tr(dutyWords(p))} color={warn} icon="moon-outline" />;
}

function Group({ role }) {
    const nav = useNavigation();
    const { text, muted, ok } = useBrand();
    const access = useOwnerStore((st) => st.access);
    const j = JOB[role];
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const load = useCallback(() => fetchStaff({ stats: true }).then((r) => { setData(r); setError(''); }).catch((e) => { useOwnerStore.getState().noteError(e); setError(apiError(e, tr('Could not load. Try again.'))); }), []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const rules = data?.rules || {};
    const [offer, setOffer] = useState({ mode: 'ask', percent: 10 });   // what he chose about offering a discount when he tells a customer about a problem
    useFocusEffect(useCallback(() => { if (role === 'kitchen') fetchSettings().then((st) => setOffer({ mode: st.orders?.kitchenOfferMode || 'ask', percent: st.orders?.kitchenOfferPercent || 10 })).catch(() => { }); }, [role]));
    const offerKey = offer.mode === 'always' ? String(offer.percent) : offer.mode;
    const on = role === 'kitchen' ? rules.kitchenOn : rules.waiterOn;
    const people = (data?.items || []).filter((p) => p.role === role);
    const active = people.filter((p) => p.isActive);
    const onDuty = active.filter((p) => p.duty === 'on').length;
    const today = people.reduce((n, p) => n + (p.stats?.today.orders || 0), 0);
    const week = people.reduce((n, p) => n + (p.stats?.week.orders || 0), 0);
    const mins = people.map((p) => p.stats?.avgMin).filter((m) => m != null);
    const avgMin = mins.length ? Math.round(mins.reduce((a, b) => a + b, 0) / mins.length) : null;
    const total = (data?.items || []).length;
    const full = total >= (rules.max || 0);
    const easy = useMenuFlags((st) => st.easy);

    const toggle = async (p, v) => {
        const set = (x) => setData((d) => ({ ...d, items: d.items.map((i) => (i.userId === p.userId ? { ...i, isActive: x } : i)) }));
        set(v);
        try { await updateStaff(p.userId, { isActive: v }); load(); } catch (e) { set(!v); useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    return (
        <FormPage title={tr(j.title)}>
            {!data && !error ? <ListShimmer /> : null}
            {error && !data ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={error} /> : null}
            {data && !on ? <Empty icon="lock-closed-outline" title={tr('This screen is not switched on')} hint={tr('Kitchen and waiter screens are switched on for your shop by the platform. Please contact support to get them.')} /> : null}
            {data && on ? (
                <>
                    <Card>
                        <View style={{ flexDirection: 'row' }}>
                            <Stat label={tr('On duty now')} value={`${onDuty} ${tr('of')} ${active.length}`} color={onDuty ? ok : text} />
                            <Stat label={tr(j.did)} value={String(today)} hint={tr(j.unit)} />
                            {!easy ? <Stat label={tr(j.didWeek)} value={String(week)} hint={tr(j.unit)} /> : null}
                        </View>
                        {!easy && avgMin != null ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 10 }}>{tr(j.avg)}: {avgMin} {tr('min')}</Text> : null}
                    </Card>

                    <LeaveRequests role={role} onChanged={load} />

                    {role === 'kitchen' ? (
                        <>
                        {!easy ? <Card>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('A new order the cook does not touch goes to his queue after')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('It stops ringing, and the cook is told it is in the queue. He can also tap Add to queue himself.')}</Text>
                            <Chips options={[[30, '30 s'], [60, '60 s'], [90, '90 s'], [120, '2 min'], [180, '3 min']]} value={rules.queueSec || 60} onChange={async (v) => { try { await saveSettings({ orders: { kitchenQueueSec: v } }); setData((d) => ({ ...d, rules: { ...d.rules, queueSec: v } })); showToast(tr('Saved')); } catch (e) { showToast(apiError(e)); } }} />
                        </Card> : null}
                        <Card>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('When you tell a customer about a kitchen problem')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Offer a discount on a new order to keep the customer? This is the choice you remembered.')}</Text>
                            <Chips options={[['ask', tr('Ask me')], ['10', '10% off'], ['15', '15% off'], ['20', '20% off'], ['never', tr('No offer')]]} value={offerKey} onChange={async (v) => { try { await saveSettings({ orders: v === 'ask' || v === 'never' ? { kitchenOfferMode: v } : { kitchenOfferMode: 'always', kitchenOfferPercent: Number(v) } }); setOffer(v === 'ask' || v === 'never' ? { mode: v, percent: offer.percent } : { mode: 'always', percent: Number(v) }); showToast(tr('Saved')); } catch (e) { showToast(apiError(e)); } }} />
                        </Card>
                                            </>
                    ) : null}

                    <SectionTitle title={tr('Your {many} ({n})', { many: tr(j.many), n: people.length })} />
                    {!people.length ? <Empty icon="people-outline" title={tr('No {many} yet', { many: tr(j.many) })} hint={tr(j.none)} /> : null}
                    {people.map((p) => (
                        <Card key={p.userId} onPress={() => nav.navigate('OwnerStaffPerson', { userId: p.userId })} style={{ opacity: p.isActive ? 1 : 0.6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <PersonAvatar person={p} />
                                <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{p.name || p.phone}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{p.phone}{p.stats ? `  ·  ${tr(j.did).toLowerCase()} ${p.stats.today.orders}` : ''}{!easy && p.stats?.avgMin != null ? `  ·  ${p.stats.avgMin} ${tr('min avg')}` : ''}</Text>
                                    <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                        <DutyPills p={p} />
                                        {p.isActive && !p.panelOn ? <View style={{ marginLeft: 6 }}><Pill label={tr('Screen is off')} color={muted} /></View> : null}
                                    </View>
                                </View>
                                <Toggle value={p.isActive} onValueChange={(v) => toggle(p, v)} disabled={access !== 'ok' && access !== 'paused'} />
                            </View>
                        </Card>
                    ))}
                    <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
                        <Button label={full ? tr('Staff limit reached ({n})', { n: rules.max }) : tr(role === 'kitchen' ? 'Add a cook' : 'Add a waiter')} icon="person-add" disabled={full} onPress={() => setAdding(true)} />
                        {!easy ? <Text style={{ color: muted, fontSize: 12.5, textAlign: 'center', marginTop: 8 }}>{tr('{n} of {max} used', { n: total, max: rules.max })}</Text> : null}
                    </View>
                </>
            ) : null}
            <AddSheet visible={adding} rules={rules} fixedRole={role} onClose={() => setAdding(false)} onDone={load} />
        </FormPage>
    );
}

export const OwnerCooksScreen = () => <Group role="kitchen" />;
export const OwnerWaitersScreen = () => <Group role="waiter" />;
