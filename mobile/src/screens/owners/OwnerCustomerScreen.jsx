// One customer: contact, how much he has ordered, cash-on-delivery status, and his name / email / your private notes.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { Card, Button, Pill, SectionTitle, Stat, Empty, money } from '../../components/owners/ui';
import { FormPage, Group, TextBox, Hint } from '../../components/owners/menuBits';
import { callPhone, whatsApp } from '../../components/owners/orderBits';
import { fetchCustomer, fetchCustomerInsight, updateCustomer, allowCod, apiError } from '../../api/owners/shopApi';
import RemindSheet from '../../components/owners/RemindSheet';
import { TAGS, usualLine, sinceLine } from '../../utils/owners/customerTags';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { personName } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerCustomerScreen() {
    const { id } = useRoute().params || {};
    const { text, muted, error, ok } = useBrand();
    const [c, setC] = useState(null);
    const [err, setErr] = useState('');
    const [form, setForm] = useState({ name: '', email: '', notes: '' });
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);
    const [ins, setIns] = useState(null);
    const [remind, setRemind] = useState(false);

    const apply = (r) => { setC(r); setForm({ name: r.name || '', email: r.email || '', notes: r.notes || '' }); };
    useEffect(() => {
        fetchCustomer(id).then(apply).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this customer.')); });
        fetchCustomerInsight(id).then(setIns).catch(() => { });
    }, [id]);

    if (!c) return <FormPage title={tr('Customer')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;

    const save = async () => {
        setSaving(true);
        try {
            const r = await updateCustomer(id, { name: form.name.trim(), email: form.email.trim(), notes: form.notes.trim() });
            setC((old) => ({ ...old, ...r })); showToast(tr('Saved'));
        } catch (e) { showToast(apiError(e)); } finally { setSaving(false); }
    };
    const allow = async () => {
        const yes = await ask({ title: tr('Allow cash on delivery again?'), message: tr('His missed-cash strikes go back to 0.'), confirmText: tr('Allow') });
        if (!yes) return;
        setBusy(true);
        try { await allowCod(id); setC((old) => ({ ...old, cod: { strikes: 0, blocked: false } })); showToast(tr('Cash on delivery is allowed again')); }
        catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    const s = c.stats || {};
    return (
        <FormPage title={personName(c)} footer={<Button label={tr('Save details')} icon="checkmark" busy={saving} onPress={save} />}>
            <Card>
                <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{personName(c)}</Text>
                <Text style={{ color: muted, marginTop: 2 }}>{c.phone}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Joined {ago}{v2}', { ago: ago(c.createdAt), v2: c.lastLoginAt ? ` · last seen ${ago(c.lastLoginAt)}` : '' })}</Text>
                {c.isBlocked ? <View style={{ marginTop: 8 }}><Pill label={tr('Blocked by the platform')} color={error} /></View> : null}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    <View style={{ flex: 1, marginRight: 6 }}><Button label={tr('Call')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(c.phone)} /></View>
                    <View style={{ flex: 1, marginLeft: 6 }}><Button label={tr('WhatsApp')} icon="logo-whatsapp" iconOnly kind="ghost" onPress={() => whatsApp(c.phone)} /></View>
                </View>
            </Card>

            {ins && ins.orders > 0 ? (
                <>
                    <SectionTitle title={tr('How he orders')} />
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Pill label={TAGS[ins.tag]?.label || ins.tag} color={TAGS[ins.tag]?.color} />
                            {ins.vip && ins.tag !== 'vip' ? <View style={{ marginLeft: 8 }}><Pill label={tr('VIP')} color={TAGS.vip.color} /></View> : null}
                        </View>
                        <Text style={{ color: text, marginTop: 10, fontWeight: '700' }}>{sinceLine(ins)}</Text>
                        <Text style={{ color: muted, marginTop: 2 }}>{tr('Usually {usualLine}', { usualLine: usualLine(ins) })}</Text>
                        {ins.favourites?.length ? <Text style={{ color: muted, marginTop: 2 }}>{tr('Favourites: {v1}', { v1: ins.favourites.map((f) => `${f.name} (${f.quantity})`).join(', ') })}</Text> : null}
                        {ins.gapDays ? <Text style={{ color: muted, marginTop: 2 }}>{tr('Orders about every {v1} day{v2}', { v1: Math.max(1, Math.round(ins.gapDays)), v2: Math.round(ins.gapDays) === 1 ? '' : 's' })}</Text> : null}
                        <Text style={{ color: ins.reachable ? muted : error, marginTop: 2, fontSize: 12 }}>{ins.reachNote}</Text>
                        {ins.nudges?.length ? <Text style={{ color: muted, marginTop: 6, fontSize: 12 }}>{tr('Last reminder: {ago}', { ago: ago(ins.nudges[0].createdAt) })}</Text> : null}
                        <View style={{ marginTop: 12 }}><Button label={tr('Remind him')} icon="notifications" disabled={!ins.reachable} onPress={() => setRemind(true)} /></View>
                    </Card>
                </>
            ) : null}

            <SectionTitle title={tr('Orders')} />
            <Card>
                <View style={{ flexDirection: 'row' }}>
                    <Stat label={tr('Orders')} value={String(s.orders || 0)} />
                    <Stat label={tr('Delivered')} value={String(s.delivered || 0)} />
                    <Stat label={tr('Cancelled')} value={String(s.cancelled || 0)} />
                </View>
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    <Stat label={tr('Spent')} value={money(s.spentTotal || 0)} />
                    <Stat label={tr('Last order')} value={s.lastOrderAt ? ago(s.lastOrderAt) : '—'} />
                </View>
            </Card>

            {c.cod ? (
                <>
                    <SectionTitle title={tr('Cash on delivery')} />
                    <Card tone={c.cod.blocked ? error : undefined}>
                        {c.cod.blocked ? (
                            <>
                                <Text style={{ color: error, fontWeight: '900' }}>{tr('Cash on delivery is stopped for him')}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('{strikes} missed cash orders are recorded for him. He can still pay online.', { strikes: c.cod.strikes })}</Text>
                                <View style={{ marginTop: 10 }}><Button label={tr('Allow cash again')} icon="cash" busy={busy} onPress={allow} /></View>
                            </>
                        ) : (
                            <Text style={{ color: c.cod.strikes ? text : ok, fontWeight: '800' }}>{c.cod.strikes ? tr('{strikes} missed cash {v2}', { strikes: c.cod.strikes, v2: c.cod.strikes === 1 ? 'order' : 'orders' }) : tr('No problems with cash orders')}</Text>
                        )}
                    </Card>
                </>
            ) : null}

            <Group title={tr('Details')} hint={tr('Notes are only for you. The customer never sees them.')}>
                <TextBox label={tr('Name')} value={form.name} onChangeText={(x) => setForm({ ...form, name: x })} maxLength={80} />
                <TextBox label={tr('Email')} value={form.email} onChangeText={(x) => setForm({ ...form, email: x })} maxLength={80} keyboardType="email-address" />
                <TextBox label={tr('Your notes')} value={form.notes} onChangeText={(x) => setForm({ ...form, notes: x })} multiline maxLength={300} last />
                <Hint>{tr('Only the platform can change a phone number.')}</Hint>
            </Group>
            {ins ? <RemindSheet visible={remind} customer={{ id: ins.id, name: ins.name }} onClose={() => setRemind(false)} onSent={() => fetchCustomerInsight(id).then(setIns).catch(() => { })} /> : null}
        </FormPage>
    );
}
