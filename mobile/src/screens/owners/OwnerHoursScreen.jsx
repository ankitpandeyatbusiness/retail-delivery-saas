// Opening hours: the week (up to 3 time slots a day; a closing time earlier than the opening time means past midnight)
// and holidays (closed from a date to a date, with a message customers see). Outside these hours customers cannot order.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Button, Empty, Field } from '../../components/owners/ui';
import { FormPage, Group, TextBox, ToggleRow, DateBox, Hint, Label } from '../../components/owners/menuBits';
import { fetchSettings, saveSettings, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { maskTime } from '../../utils/owners/menuRules';
import { DAY_KEYS, DAY_NAMES, MAX_SLOTS, MAX_HOLIDAYS, weeklyToForm, formToWeekly, hoursProblem, holidaysProblem } from '../../utils/owners/settingsRules';
import { showToast } from '../../components/customers/shop';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

function DayRow({ day, slots, onChange }) {
    const { text, muted, border, primary, error, surface } = useBrand();
    const open = slots.length > 0;
    const set = (i, patch) => onChange(slots.map((s, n) => (n === i ? { ...s, ...patch } : s)));
    return (
        <View style={{ paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 15 }}>{DAY_NAMES[day]}</Text>
                <Text style={{ color: open ? muted : error, fontWeight: '700', marginRight: 10 }}>{open ? tr('Open') : tr('Closed')}</Text>
                <Pressable onPress={() => onChange(open ? [] : [{ open: '09:00', close: '22:00' }])} hitSlop={8}>
                    <Ionicons name={open ? 'toggle' : 'toggle-outline'} size={38} color={open ? primary : muted} />
                </Pressable>
            </View>
            {slots.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                    <View style={{ flex: 1 }}><Field value={s.open} onChangeText={(x) => set(i, { open: maskTime(x) })} placeholder="09:00" keyboardType="number-pad" maxLength={5} style={{ minHeight: 42, textAlign: 'center' }} /></View>
                    <Text style={{ color: muted, marginHorizontal: 10 }}>{tr('to')}</Text>
                    <View style={{ flex: 1 }}><Field value={s.close} onChangeText={(x) => set(i, { close: maskTime(x) })} placeholder="22:00" keyboardType="number-pad" maxLength={5} style={{ minHeight: 42, textAlign: 'center' }} /></View>
                    <Pressable onPress={() => onChange(slots.filter((_, n) => n !== i))} hitSlop={8} style={{ marginLeft: 10 }}><Ionicons name="close-circle" size={22} color={muted} /></Pressable>
                </View>
            ))}
            {open && slots.length < MAX_SLOTS ? (
                <Pressable onPress={() => onChange([...slots, { open: '18:00', close: '22:00' }])} style={{ marginTop: 8 }}>
                    <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{tr('+ Add another time (for example evening)')}</Text>
                </Pressable>
            ) : null}
        </View>
    );
}

export default function OwnerHoursScreen() {
    const nav = useNavigation();
    const { muted, error } = useBrand();
    const access = useOwnerStore((s) => s.access);
    const [week, setWeek] = useState(null);
    const [message, setMessage] = useState('');
    const [holidays, setHolidays] = useState([]);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        fetchSettings().then((s) => {
            setWeek(weeklyToForm(s.hours.weekly));
            setMessage(s.hours.closedMessage || '');
            setHolidays((s.hours.closedDates || []).map((h) => ({ from: h.from, to: h.to, message: h.message || '' })));
        }).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your opening hours.')); });
    }, []);

    if (!week) return <FormPage title={tr('Opening hours')}>{err ? <Empty icon={access === 'ok' ? 'cloud-offline-outline' : 'lock-closed-outline'} title={access === 'ok' ? tr('Could not load') : tr('Locked while rent is unpaid')} hint={err} /> : <FormShimmer />}</FormPage>;

    const setDay = (d, slots) => setWeek((w) => ({ ...w, days: { ...w.days, [d]: slots } }));
    const setHoliday = (i, patch) => setHolidays((hs) => hs.map((h, n) => (n === i ? { ...h, ...patch } : h)));

    const save = async () => {
        const problem = hoursProblem(week) || holidaysProblem(holidays);
        if (problem) { showToast(problem); return; }
        setSaving(true);
        try {
            await saveSettings({
                hours: {
                    weekly: formToWeekly(week), closedMessage: message.trim(),
                    closedDates: holidays.map((h) => ({ from: h.from, to: h.to, ...(h.message.trim() ? { message: h.message.trim() } : {}) })),
                },
            });
            useHomeStore.getState().load && useHomeStore.getState().load({ quiet: true });
            showToast(tr('Opening hours saved'));
            nav.goBack();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    return (
        <FormPage title={tr('Opening hours')} footer={<Button label={tr('Save hours')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('Every week')} hint={tr('Times are in 24-hour format. Customers cannot order outside these hours.')}>
                <ToggleRow title={tr('Use opening hours')} subtitle={week.hasHours ? undefined : tr('Off: you take orders whenever orders are switched on')} value={week.hasHours} onValueChange={(x) => setWeek((w) => ({ ...w, hasHours: x }))} last={!week.hasHours} />
                {week.hasHours ? DAY_KEYS.map((d) => <DayRow key={d} day={d} slots={week.days[d]} onChange={(s) => setDay(d, s)} />) : null}
                {week.hasHours ? <Hint>{tr('A closing time before the opening time (like 18:00 to 02:00) means you close after midnight.')}</Hint> : null}
            </Group>

            <Group title={tr('Message when closed')} hint={tr('Customers see this when the shop is closed.')}>
                <TextBox value={message} onChangeText={setMessage} maxLength={120} placeholder={tr('e.g. We open again at 9 AM')} last />
            </Group>

            <Group title={tr('Holidays')} hint={tr('Closed from a day to a day. Orders stop on their own and start again after.')}>
                {holidays.map((h, i) => (
                    <View key={i} style={{ marginBottom: 14, paddingBottom: 12, borderBottomWidth: 0.5, borderBottomColor: alpha(muted, 0.4) }}>
                        <DateBox label={tr('First closed day')} value={h.from} onChange={(x) => setHoliday(i, { from: x })} />
                        <DateBox label={tr('Last closed day')} value={h.to} onChange={(x) => setHoliday(i, { to: x })} />
                        <TextBox label={tr('Message (optional)')} value={h.message} onChangeText={(x) => setHoliday(i, { message: x })} maxLength={120} placeholder={tr('e.g. Closed for Diwali')} last />
                        <Pressable onPress={() => setHolidays((hs) => hs.filter((_, n) => n !== i))} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
                            <Ionicons name="trash-outline" size={17} color={error} /><Text style={{ color: error, fontWeight: '700', marginLeft: 6 }}>{tr('Remove this holiday')}</Text>
                        </Pressable>
                    </View>
                ))}
                {holidays.length < MAX_HOLIDAYS ? <Button label={tr('Add a holiday')} kind="ghost" icon="calendar" onPress={() => setHolidays((hs) => [...hs, { from: '', to: '', message: '' }])} /> : null}
            </Group>
        </FormPage>
    );
}
