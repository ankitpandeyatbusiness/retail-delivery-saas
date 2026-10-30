// Table booking rules: the on/off slider, when guests can book, seats, group sizes, the deposit, and days or times that are closed.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Card, Empty, LiveToggle } from '../../components/owners/ui';
import { FormPage, Group, TextBox, NumberBox, ChoiceBox, DateBox, TimingEditor, Toggle } from '../../components/owners/menuBits';
import { booking as api, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { maskTime } from '../../utils/owners/menuRules';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerBookingSettingsScreen() {
    const { text, muted, border, error } = useBrand();
    const [v, setV] = useState(null);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);
    const [flipping, setFlipping] = useState(false);
    const [closeDate, setCloseDate] = useState('');
    const [closeTime, setCloseTime] = useState('');

    useEffect(() => { api.settings().then(setV).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open the booking settings.')); }); }, []);
    if (!v) return <FormPage title={tr('Table booking')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k, x) => setV((f) => ({ ...f, [k]: x }));

    // the slider saves by itself, so a guest sees the change at once (the server refuses it until the deposit and times are set)
    const flip = async () => {
        setFlipping(true);
        try { const r = await api.saveSettings({ enabled: !v.enabled }); set('enabled', r.enabled); }
        catch (e) { showToast(apiError(e)); } finally { setFlipping(false); }
    };

    const save = async () => {
        setSaving(true);
        try {
            const { tenantId, _id, createdAt, updatedAt, __v, ...rules } = v;   // eslint-disable-line no-unused-vars
            setV(await api.saveSettings(rules));
            showToast(tr('Booking settings saved'));
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const setTable = (i, patch) => set('tables', v.tables.map((t, j) => (j === i ? { ...t, ...patch } : t)));
    const nextNo = () => String(v.tables.reduce((m, t) => Math.max(m, Number(t.no) || 0), 0) + 1);
    const fillFromDineIn = () => set('tables', Array.from({ length: v.dineTableCount }, (_, i) => ({ no: String(i + 1), seats: 4, bookable: true })));

    const addClosed = () => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) return showToast(tr('Type the date as 2026-11-01'));
        if (closeTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(closeTime)) return showToast(tr('Type the time like 19:30'));
        if (closeTime) set('closedSlots', [...(v.closedSlots || []), { date: closeDate, time: closeTime }]);
        else set('closedDates', [...new Set([...(v.closedDates || []), closeDate])].sort());
        setCloseDate(''); setCloseTime('');
    };

    const closedItems = [
        ...(v.closedDates || []).map((d) => ({ key: d, label: tr('{d}, whole day', { d }), drop: () => set('closedDates', v.closedDates.filter((x) => x !== d)) })),
        ...(v.closedSlots || []).map((s) => ({ key: `${s.date} ${s.time}`, label: `${s.date} ${s.time}`, drop: () => set('closedSlots', v.closedSlots.filter((x) => x !== s)) })),
    ];

    return (
        <FormPage title={tr('Table booking')} footer={<Button label={tr('Save changes')} icon="checkmark" busy={saving} onPress={save} />}>
            <Card style={{ marginHorizontal: 0 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{v.enabled ? tr('Guests can book a table') : tr('Table booking is off')}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr('Set the times and the deposit first, then switch it on.')}</Text>
                    </View>
                    <LiveToggle on={!!v.enabled} busy={flipping} onPress={flip} />
                </View>
            </Card>
            {v.featureOn === false ? <Text style={{ color: error, fontWeight: '800', marginTop: 10 }}>{tr('Table booking is not switched on for your shop yet. Ask us to switch it on.')}</Text> : null}
            <Group title={tr('When guests can book')} hint={tr('Add a time for lunch and another for dinner. Days left empty means every day.')}>
                <TimingEditor value={v.windows} onChange={(x) => set('windows', x)} />
            </Group>
            <Group title={tr('Your tables')} hint={tr('Guests pick one of these, like seats in a cinema. Use the same numbers as your table QR codes.')}>
                {!v.tables.length && v.dineTableCount > 0 ? <Button label={tr('Add my {n} dine in tables', { n: v.dineTableCount })} icon="grid-outline" kind="ghost" onPress={fillFromDineIn} style={{ marginBottom: 10 }} /> : null}
                {v.tables.map((t, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6, opacity: t.bookable ? 1 : 0.6 }}>
                        <View style={{ flex: 1, marginRight: 8 }}><TextBox label={i === 0 ? tr('Table') : undefined} value={t.no} onChangeText={(x) => setTable(i, { no: x })} maxLength={10} last /></View>
                        <View style={{ flex: 1, marginRight: 8 }}><NumberBox label={i === 0 ? tr('Seats') : undefined} integer value={t.seats} onChange={(x) => setTable(i, { seats: x ?? 1 })} last /></View>
                        <View style={{ height: 46, justifyContent: 'center', marginRight: 6 }}><Toggle value={t.bookable} onValueChange={(x) => setTable(i, { bookable: x })} /></View>
                        <Pressable onPress={() => set('tables', v.tables.filter((_, j) => j !== i))} hitSlop={8} style={{ height: 46, justifyContent: 'center' }}><Ionicons name="trash-outline" size={20} color={error} /></Pressable>
                    </View>
                ))}
                <Button label={tr('Add a table')} icon="add" kind="ghost" onPress={() => set('tables', [...v.tables, { no: nextNo(), seats: 4, bookable: true }])} />
                <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('The switch decides if guests can book that table.')}</Text>
            </Group>
            <Group title={tr('Groups and times')}>
                <ChoiceBox label={tr('How long a booking lasts')} options={[30, 45, 60, 90, 120].map((m) => [m, tr('{m} min', { m })])} value={v.slotMinutes} onChange={(x) => set('slotMinutes', x)} />
                <NumberBox label={tr('Smallest group')} integer value={v.minParty} onChange={(x) => set('minParty', x)} />
                <NumberBox label={tr('Largest group')} integer value={v.maxParty} onChange={(x) => set('maxParty', x)} />
                <NumberBox label={tr('How many days ahead can they book')} integer value={v.advanceDays} onChange={(x) => set('advanceDays', x)} />
                <NumberBox label={tr('Notice needed, in minutes')} integer value={v.minNoticeMinutes} onChange={(x) => set('minNoticeMinutes', x)} last />
            </Group>
            <Group title={tr('Deposit guests must pay')} hint={tr('A booking counts only once the deposit is paid.')}>
                <ChoiceBox label={tr('How it is worked out')} options={[['per_person', tr('Per person')], ['flat', tr('One amount')]]} value={v.depositType} onChange={(x) => set('depositType', x)} />
                <NumberBox label={v.depositType === 'per_person' ? tr('Amount per person') : tr('Amount')} prefix="₹" integer value={v.depositAmount || undefined} onChange={(x) => set('depositAmount', x ?? 0)} />
                <ChoiceBox label={tr('What happens to it')} options={[['adjust', tr('Taken off the bill')], ['keep', tr('You keep it')]]} value={v.depositMode} onChange={(x) => set('depositMode', x)} />
                <NumberBox label={tr('Full refund if cancelled this many hours before')} integer value={v.refundHours} onChange={(x) => set('refundHours', x)} last />
            </Group>
            <Group title={tr('Close a day or a time')} hint={tr('Leave the time empty to close the whole day.')}>
                <DateBox label={tr('Date')} value={closeDate} onChange={setCloseDate} />
                <TextBox label={tr('Time (optional)')} value={closeTime} onChangeText={(x) => setCloseTime(maskTime(x))} keyboardType="number-pad" placeholder="19:00" maxLength={5} />
                <Button label={tr('Close it')} icon="close-circle-outline" kind="ghost" onPress={addClosed} />
                {closedItems.map((c) => (
                    <View key={c.key} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 1, borderTopColor: border, marginTop: 8 }}>
                        <Text style={{ color: text, flex: 1, fontWeight: '700' }}>{c.label}</Text>
                        <Pressable onPress={c.drop} hitSlop={8}><Ionicons name="trash-outline" size={19} color={error} /></Pressable>
                    </View>
                ))}
            </Group>
        </FormPage>
    );
}
