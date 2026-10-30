// Book a table: pick the day, the number of guests and a time; the deposit is shown before you confirm.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, Label } from '../../components/owners/menuBits';
import { fetchBookingConfig, fetchBookingSlots, createBooking } from '../../api/customers/shopApi';
import { FormShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

const plus = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dayLabel = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });

export default function BookTableScreen() {
    const nav = useNavigation();
    const { text, muted, primary, onPrimary, border, surface } = useBrand();
    const [cfg, setCfg] = useState(null);
    const [err, setErr] = useState('');
    const [date, setDate] = useState('');
    const [party, setParty] = useState(2);
    const [slots, setSlots] = useState(null);
    const [deposit, setDeposit] = useState(0);
    const [time, setTime] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetchBookingConfig().then((c) => { setCfg(c); setDate(c.today); setParty(Math.max(c.minParty, Math.min(2, c.maxParty))); setName(c.me?.name || ''); setPhone(c.me?.phone || ''); })
            .catch((e) => setErr(e?.response?.data?.error || tr('Could not load')));
    }, []);
    useEffect(() => {
        if (!cfg?.enabled || !date) return;
        let live = true;
        setSlots(null); setTime('');
        fetchBookingSlots(date, party).then((r) => { if (live) { setSlots(r.slots); setDeposit(r.deposit); } }).catch(() => { if (live) setSlots([]); });
        return () => { live = false; };
    }, [cfg, date, party]);

    if (!cfg) return <FormPage title={tr('Book a table')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    if (!cfg.enabled) return <FormPage title={tr('Book a table')}><Empty icon="calendar-outline" title={tr('Booking is closed')} hint={tr('This shop is not taking table bookings right now.')} /></FormPage>;

    const days = Array.from({ length: Math.min(cfg.advanceDays, 30) + 1 }, (_, i) => plus(cfg.today, i));
    const d = cfg.deposit;
    const send = async () => {
        if (!time) return showToast(tr('Pick a time'));
        if (!name.trim()) return showToast(tr('Please enter your name'));
        if (phone.replace(/\D/g, '').length < 6) return showToast(tr('Please enter your phone number'));
        setBusy(true);
        try {
            await createBooking({ date, time, party, name: name.trim(), phone: phone.trim(), note: note.trim() });
            showToast(tr('Table booked'));
            nav.replace('MyBookings');
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not book. Try again.')); } finally { setBusy(false); }
    };
    const step = (n) => setParty((p) => Math.max(cfg.minParty, Math.min(cfg.maxParty, p + n)));
    const stepBtn = (n, icon) => (
        <Pressable onPress={() => step(n)} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', backgroundColor: surface }}>
            <Ionicons name={icon} size={22} color={text} />
        </Pressable>
    );

    return (
        <FormPage title={tr('Book a table')} footer={<Button label={deposit ? tr('Book table · deposit ₹{n}', { n: deposit }) : tr('Book table')} icon="calendar" busy={busy} disabled={!time} onPress={send} />}>
            <Label>{tr('Day')}</Label>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                {days.map((x) => {
                    const on = x === date;
                    return (
                        <Pressable key={x} onPress={() => setDate(x)} style={{ width: 58, paddingVertical: 10, marginRight: 8, borderRadius: 14, alignItems: 'center', borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : surface }}>
                            <Text style={{ color: on ? onPrimary : muted, fontSize: 12 }}>{x === cfg.today ? tr('Today') : dayLabel(x)}</Text>
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 18 }}>{x.slice(8)}</Text>
                        </Pressable>
                    );
                })}
            </ScrollView>
            <Label>{tr('Guests')}</Label>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                {stepBtn(-1, 'remove')}
                <Text style={{ color: text, fontWeight: '900', fontSize: 22, minWidth: 64, textAlign: 'center' }}>{party}</Text>
                {stepBtn(1, 'add')}
            </View>
            <Label>{tr('Time')}</Label>
            {slots === null ? <Text style={{ color: muted, marginBottom: 14 }}>{tr('Looking for free tables...')}</Text> : null}
            {slots && !slots.length ? <Text style={{ color: muted, marginBottom: 14 }}>{tr('No times on this day. Try another day.')}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
                {(slots || []).map((s) => {
                    const on = s.time === time;
                    return (
                        <Pressable key={s.time} disabled={!s.ok} onPress={() => setTime(s.time)} style={{ minWidth: 84, marginRight: 8, marginBottom: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : surface, opacity: s.ok ? 1 : 0.4 }}>
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 15 }}>{s.time}</Text>
                            {!s.ok ? <Text style={{ color: muted, fontSize: 10 }}>{tr('Full')}</Text> : null}
                        </Pressable>
                    );
                })}
            </View>
            <View style={{ backgroundColor: surface, borderRadius: 14, borderWidth: 1, borderColor: border, padding: 14, marginVertical: 10 }}>
                <Text style={{ color: primary, fontWeight: '900', fontSize: 18 }}>{tr('Deposit ₹{n}', { n: deposit || d.amount })}</Text>
                <Text style={{ color: muted, fontSize: 13, marginTop: 4 }}>
                    {d.type === 'per_person' ? tr('₹{a} per person. ', { a: d.amount }) : ''}{d.mode === 'adjust' ? tr('It is taken off your bill.') : tr('The restaurant keeps it.')}
                </Text>
                <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{tr('Full refund if you cancel at least {h} hours before.', { h: d.refundHours })}</Text>
            </View>
            <Group title={tr('Your details')}>
                <TextBox label={tr('Your name')} value={name} onChangeText={setName} maxLength={80} />
                <TextBox label={tr('Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
                <TextBox label={tr('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} placeholder={tr('Birthday, window seat, high chair...')} last />
            </Group>
        </FormPage>
    );
}
