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

    if (!c) return <FormPage title="Customer">{err ? <Empty icon="cloud-offline-outline" title="Could not open" hint={err} /> : <FormShimmer />}</FormPage>;

    const save = async () => {
        setSaving(true);
        try {
            const r = await updateCustomer(id, { name: form.name.trim(), email: form.email.trim(), notes: form.notes.trim() });
            setC((old) => ({ ...old, ...r })); showToast('Saved');
        } catch (e) { showToast(apiError(e)); } finally { setSaving(false); }
    };
    const allow = async () => {
        const yes = await ask({ title: 'Allow cash on delivery again?', message: 'His missed-cash strikes go back to 0.', confirmText: 'Allow' });
        if (!yes) return;
        setBusy(true);
        try { await allowCod(id); setC((old) => ({ ...old, cod: { strikes: 0, blocked: false } })); showToast('Cash on delivery is allowed again'); }
        catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    const s = c.stats || {};
    return (
        <FormPage title={personName(c)} footer={<Button label="Save details" icon="checkmark" busy={saving} onPress={save} />}>
            <Card>
                <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{personName(c)}</Text>
                <Text style={{ color: muted, marginTop: 2 }}>{c.phone}</Text>
                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>Joined {ago(c.createdAt)}{c.lastLoginAt ? ` · last seen ${ago(c.lastLoginAt)}` : ''}</Text>
                {c.isBlocked ? <View style={{ marginTop: 8 }}><Pill label="Blocked by the platform" color={error} /></View> : null}
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    <View style={{ flex: 1, marginRight: 6 }}><Button label="Call" icon="call" kind="ghost" onPress={() => callPhone(c.phone)} /></View>
                    <View style={{ flex: 1, marginLeft: 6 }}><Button label="WhatsApp" icon="logo-whatsapp" kind="ghost" onPress={() => whatsApp(c.phone)} /></View>
                </View>
            </Card>

            {ins && ins.orders > 0 ? (
                <>
                    <SectionTitle title="How he orders" />
                    <Card>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                            <Pill label={TAGS[ins.tag]?.label || ins.tag} color={TAGS[ins.tag]?.color} />
                            {ins.vip && ins.tag !== 'vip' ? <View style={{ marginLeft: 8 }}><Pill label="VIP" color={TAGS.vip.color} /></View> : null}
                        </View>
                        <Text style={{ color: text, marginTop: 10, fontWeight: '700' }}>{sinceLine(ins)}</Text>
                        <Text style={{ color: muted, marginTop: 2 }}>Usually {usualLine(ins)}</Text>
                        {ins.favourites?.length ? <Text style={{ color: muted, marginTop: 2 }}>Favourites: {ins.favourites.map((f) => `${f.name} (${f.quantity})`).join(', ')}</Text> : null}
                        {ins.gapDays ? <Text style={{ color: muted, marginTop: 2 }}>Orders about every {Math.max(1, Math.round(ins.gapDays))} day{Math.round(ins.gapDays) === 1 ? '' : 's'}</Text> : null}
                        <Text style={{ color: ins.reachable ? muted : error, marginTop: 2, fontSize: 12 }}>{ins.reachNote}</Text>
                        {ins.nudges?.length ? <Text style={{ color: muted, marginTop: 6, fontSize: 12 }}>Last reminder: {ago(ins.nudges[0].createdAt)}</Text> : null}
                        <View style={{ marginTop: 12 }}><Button label="Remind him" icon="notifications" disabled={!ins.reachable} onPress={() => setRemind(true)} /></View>
                    </Card>
                </>
            ) : null}

            <SectionTitle title="Orders" />
            <Card>
                <View style={{ flexDirection: 'row' }}>
                    <Stat label="Orders" value={String(s.orders || 0)} />
                    <Stat label="Delivered" value={String(s.delivered || 0)} />
                    <Stat label="Cancelled" value={String(s.cancelled || 0)} />
                </View>
                <View style={{ flexDirection: 'row', marginTop: 12 }}>
                    <Stat label="Spent" value={money(s.spentTotal || 0)} />
                    <Stat label="Last order" value={s.lastOrderAt ? ago(s.lastOrderAt) : '—'} />
                </View>
            </Card>

            {c.cod ? (
                <>
                    <SectionTitle title="Cash on delivery" />
                    <Card tone={c.cod.blocked ? error : undefined}>
                        {c.cod.blocked ? (
                            <>
                                <Text style={{ color: error, fontWeight: '900' }}>Cash on delivery is stopped for him</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{c.cod.strikes} missed cash orders are recorded for him. He can still pay online.</Text>
                                <View style={{ marginTop: 10 }}><Button label="Allow cash again" icon="cash" busy={busy} onPress={allow} /></View>
                            </>
                        ) : (
                            <Text style={{ color: c.cod.strikes ? text : ok, fontWeight: '800' }}>{c.cod.strikes ? `${c.cod.strikes} missed cash ${c.cod.strikes === 1 ? 'order' : 'orders'}` : 'No problems with cash orders'}</Text>
                        )}
                    </Card>
                </>
            ) : null}

            <Group title="Details" hint="Notes are only for you. The customer never sees them.">
                <TextBox label="Name" value={form.name} onChangeText={(x) => setForm({ ...form, name: x })} maxLength={80} />
                <TextBox label="Email" value={form.email} onChangeText={(x) => setForm({ ...form, email: x })} maxLength={80} keyboardType="email-address" />
                <TextBox label="Your notes" value={form.notes} onChangeText={(x) => setForm({ ...form, notes: x })} multiline maxLength={300} last />
                <Hint>Only the platform can change a phone number.</Hint>
            </Group>
            {ins ? <RemindSheet visible={remind} customer={{ id: ins.id, name: ins.name }} onClose={() => setRemind(false)} onSent={() => fetchCustomerInsight(id).then(setIns).catch(() => { })} /> : null}
        </FormPage>
    );
}
