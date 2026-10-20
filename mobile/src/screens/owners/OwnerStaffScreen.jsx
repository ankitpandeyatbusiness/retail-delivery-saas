// The shop's own people: the kitchen cooks and the waiters. The owner adds a mobile number and a job; the person signs in with an OTP on
// their own phone and sees only their screen. Which jobs exist, and how many people, is decided by the platform (super admin) for this shop.
import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Pill, Button, Empty, Sheet, Field, Chips } from '../../components/owners/ui';
import { FormPage, Toggle } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { callPhone } from '../../components/owners/orderBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { fetchStaff, addStaff, updateStaff, removeStaff, apiError } from '../../api/owners/shopApi';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { tr } from '../../i18n';

const JOB_LABEL = { kitchen: 'Kitchen', waiter: 'Waiter' };
const jobOptions = (rules) => [['kitchen', tr('Kitchen')], ['waiter', tr('Waiter')]].filter(([k]) => (k === 'kitchen' ? rules.kitchenOn : rules.waiterOn));

function AddSheet({ visible, rules, onClose, onDone }) {
    const { muted } = useBrand();
    const jobs = jobOptions(rules);
    const [phone, setPhone] = useState('');
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [busy, setBusy] = useState(false);
    const job = role || jobs[0]?.[0] || '';
    const ok = /^[6-9]\d{9}$/.test(phone) && !!job;
    const submit = async () => {
        setBusy(true);
        try {
            await addStaff({ phone, name: name.trim() || undefined, role: job });
            showToast(tr('Staff added'));
            setPhone(''); setName(''); setRole('');
            onClose();
            onDone();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Add staff')}>
            <Text style={{ color: muted, marginBottom: 10 }}>{tr('They sign in to this app with their mobile number and see only their own screen.')}</Text>
            {jobs.length > 1 ? <Chips options={jobs} value={job} onChange={setRole} style={{ marginTop: 0, marginBottom: 8 }} /> : null}
            <Field value={phone} onChangeText={(x) => setPhone(x.replace(/\D/g, '').slice(0, 10))} placeholder={tr('Mobile number (10 digits)')} maxLength={10} keyboardType="number-pad" style={{ marginBottom: 10 }} />
            <Field value={name} onChangeText={setName} placeholder={tr('Name (optional)')} maxLength={40} style={{ marginBottom: 14 }} />
            <Button label={tr('Add')} icon="person-add" disabled={!ok} busy={busy} onPress={submit} />
        </Sheet>
    );
}

function EditSheet({ person, rules, onClose, onDone }) {
    const { muted } = useBrand();
    const jobs = jobOptions(rules);
    const [name, setName] = useState('');
    const [role, setRole] = useState('');
    const [busy, setBusy] = useState('');
    React.useEffect(() => { if (person) { setName(person.name || ''); setRole(person.role); } }, [person]);
    if (!person) return <Sheet visible={false} onClose={onClose} title="" />;
    const changed = name.trim() !== (person.name || '') || role !== person.role;
    const save = async () => {
        setBusy('save');
        try {
            await updateStaff(person.userId, { name: name.trim(), ...(role !== person.role ? { role } : {}) });
            showToast(tr('Saved'));
            onClose();
            onDone();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(''); }
    };
    const remove = async () => {
        const yes = await ask({ title: tr('Remove {name}?', { name: person.name || person.phone }), message: tr('They are logged out at once and lose access to the shop screens. You can add them again later.'), confirmText: tr('Remove'), cancelText: tr('Cancel') });
        if (!yes) return;
        setBusy('remove');
        try { await removeStaff(person.userId); showToast(tr('Removed')); onClose(); onDone(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(''); }
    };
    return (
        <Sheet visible onClose={onClose} title={person.name || person.phone}>
            <Text style={{ color: muted, marginBottom: 10 }}>{person.phone}</Text>
            <Field value={name} onChangeText={setName} placeholder={tr('Name')} maxLength={40} style={{ marginBottom: 10 }} />
            {jobs.length > 1 || (jobs.length === 1 && jobs[0][0] !== person.role) ? <Chips options={jobs.some(([k]) => k === person.role) ? jobs : [[person.role, tr(JOB_LABEL[person.role])], ...jobs]} value={role} onChange={setRole} style={{ marginTop: 0, marginBottom: 8 }} /> : null}
            <Button label={tr('Save')} icon="checkmark" disabled={!changed || name.trim().length < 1} busy={busy === 'save'} onPress={save} style={{ marginTop: 6 }} />
            <Button label={tr('Call')} icon="call" kind="ghost" onPress={() => callPhone(person.phone)} style={{ marginTop: 10 }} />
            <Button label={tr('Remove from staff')} icon="trash" kind="danger" busy={busy === 'remove'} onPress={remove} style={{ marginTop: 10 }} />
        </Sheet>
    );
}

export default function OwnerStaffScreen() {
    const { text, muted, ok, warn } = useBrand();
    const access = useOwnerStore((st) => st.access);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const [edit, setEdit] = useState(null);

    const load = useCallback(() => fetchStaff().then((r) => { setData(r); setError(''); }).catch((e) => { useOwnerStore.getState().noteError(e); setError(apiError(e, tr('Could not load your staff. Try again.'))); }), []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const toggle = async (p, on) => {
        const set = (v) => setData((d) => ({ ...d, items: d.items.map((x) => (x.userId === p.userId ? { ...x, isActive: v } : x)) }));
        set(on);
        try { await updateStaff(p.userId, { isActive: on }); } catch (e) { set(!on); useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const rules = data?.rules || {};
    const anyOn = rules.kitchenOn || rules.waiterOn;
    const items = data?.items || [];
    const full = items.length >= (rules.max || 0);

    return (
        <FormPage title={tr('Staff')}>
            {!data && !error ? <ListShimmer /> : null}
            {error && !data ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={error} /> : null}
            {data && !anyOn ? (
                <Empty icon="lock-closed-outline" title={tr('Staff screens are not switched on')} hint={tr('Kitchen and waiter screens are switched on for your shop by the platform. Please contact support to get them.')} />
            ) : null}
            {data && anyOn ? (
                <>
                    <Text style={{ color: muted, paddingHorizontal: 16, marginBottom: 12, lineHeight: 20 }}>
                        {tr('Add your cooks and waiters with their mobile numbers. They sign in with an OTP and see only their own screen: no money, no customers, no settings.')}
                    </Text>
                    {!items.length ? <Empty icon="people-outline" title={tr('No staff yet')} hint={tr('Add a cook or a waiter to start.')} /> : null}
                    {items.map((p) => (
                        <Card key={p.userId} onPress={() => setEdit(p)} style={{ opacity: p.isActive ? 1 : 0.6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{p.name || p.phone}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{p.phone}</Text>
                                    <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                        <Pill label={tr(JOB_LABEL[p.role])} icon={p.role === 'kitchen' ? 'flame' : 'restaurant'} />
                                        {!p.isActive ? <View style={{ marginLeft: 6 }}><Pill label={tr('Switched off')} color={muted} /></View> : null}
                                        {p.isActive && !p.panelOn ? <View style={{ marginLeft: 6 }}><Pill label={tr('Screen is off')} color={warn} /></View> : null}
                                        {p.isActive && p.panelOn ? <View style={{ marginLeft: 6 }}><Pill label={tr('Can sign in')} color={ok} /></View> : null}
                                    </View>
                                </View>
                                <Toggle value={p.isActive} onValueChange={(on) => toggle(p, on)} disabled={access !== 'ok' && access !== 'paused'} />
                            </View>
                        </Card>
                    ))}
                    <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
                        <Button label={full ? tr('Staff limit reached ({n})', { n: rules.max }) : tr('Add staff')} icon="person-add" disabled={full} onPress={() => setAdding(true)} />
                        <Text style={{ color: muted, fontSize: 12.5, textAlign: 'center', marginTop: 8 }}>{tr('{n} of {max} used', { n: items.length, max: rules.max })}</Text>
                    </View>
                </>
            ) : null}
            <AddSheet visible={adding} rules={rules} onClose={() => setAdding(false)} onDone={load} />
            <EditSheet person={edit} rules={rules} onClose={() => setEdit(null)} onDone={load} />
        </FormPage>
    );
}
