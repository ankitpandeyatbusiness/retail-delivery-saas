// Table booking rules: the on/off slider, when guests can book, seats, group sizes, the deposit, and days or times that are closed.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Card, Empty, LiveToggle } from '../../components/owners/ui';
import { FormPage, Group, TextBox, NumberBox, ChoiceBox, DateBox, TimingEditor } from '../../components/owners/menuBits';
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
            <Group title={tr('When guests can book')} hint={tr('Add a time for lunch and another for dinner. Days left empty means every day.')}>
                <TimingEditor value={v.windows} onChange={(x) => set('windows', x)} />
            </Group>
            <Group title={tr('Seats and groups')}>
                <ChoiceBox label={tr('Slot length')} options={[30, 45, 60, 90, 120].map((m) => [m, tr('{m} min', { m })])} value={v.slotMinutes} onChange={(x) => set('slotMinutes', x)} />
                <NumberBox label={tr('Guests you can seat in one slot')} integer value={v.seatsPerSlot} onChange={(x) => set('seatsPerSlot', x)} />
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
