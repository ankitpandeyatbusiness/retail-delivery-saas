// Book a table, cinema style: pick the day, the group, the time, then tap a TABLE on the map. A table someone else has is greyed out. The deposit is
// shown before you pay. When every table of a time is taken you can join the waitlist and are told if one comes free.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, Label } from '../../components/owners/menuBits';
import { fetchBookingConfig, fetchBookingSlots, fetchBookingTables, createBooking, joinWaitlist, leaveWaitlist, fetchMyWaitlist } from '../../api/customers/shopApi';
import { payBooking } from '../../utils/customers/payBooking';
import { FormShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

const plus = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dayLabel = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', timeZone: 'UTC' });

export default function BookTableScreen() {
    const nav = useNavigation();
    const { text, muted, primary, onPrimary, border, surface, error } = useBrand();
    const [cfg, setCfg] = useState(null);
    const [err, setErr] = useState('');
    const [date, setDate] = useState('');
    const [party, setParty] = useState(2);
    const [slots, setSlots] = useState(null);
    const [time, setTime] = useState('');
    const [tables, setTables] = useState(null);
    const [table, setTable] = useState('');
    const [deposit, setDeposit] = useState(0);
    const [waits, setWaits] = useState([]);   // my waitlist entries
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetchBookingConfig().then((c) => { setCfg(c); setDate(c.today); setParty(Math.max(c.minParty, Math.min(2, c.maxParty))); setName(c.me?.name || ''); setPhone(c.me?.phone || ''); })
            .catch((e) => setErr(e?.response?.data?.error || tr('Could not load')));
        fetchMyWaitlist().then((r) => setWaits(r.items || [])).catch(() => { });
    }, []);

    const loadSlots = useCallback(() => {
        if (!cfg?.enabled || !date) return Promise.resolve();
        return fetchBookingSlots(date, party).then((r) => { setSlots(r.slots); setDeposit(r.deposit); }).catch(() => setSlots([]));
    }, [cfg, date, party]);
    const loadTables = useCallback(() => {
        if (!cfg?.enabled || !date || !time) return Promise.resolve();
        return fetchBookingTables(date, time, party).then((r) => { setTables(r.tables); setDeposit(r.deposit); setTable((cur) => (r.tables.some((t) => t.no === cur && t.state === 'free') ? cur : ''));   // a table taken meanwhile is dropped
        }).catch(() => setTables([]));
    }, [cfg, date, time, party]);

    useEffect(() => { setSlots(null); setTime(''); setTables(null); setTable(''); loadSlots(); }, [loadSlots]);
    useEffect(() => {
        setTables(null); setTable('');
        if (!time) return undefined;
        loadTables();
        const t = setInterval(loadTables, 15000);   // other guests are booking too: the map stays up to date
        return () => clearInterval(t);
    }, [time, loadTables]);

    if (!cfg) return <FormPage title={tr('Book a table')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    if (!cfg.enabled) return <FormPage title={tr('Book a table')}><Empty icon="calendar-outline" title={tr('Booking is closed')} hint={tr('This shop is not taking table bookings right now.')} /></FormPage>;

    const days = Array.from({ length: Math.min(cfg.advanceDays, 30) + 1 }, (_, i) => plus(cfg.today, i));
    const d = cfg.deposit;
    const slot = (slots || []).find((s) => s.time === time);
    const full = !!slot && slot.full;
    const myWait = waits.find((w) => w.date === date && w.time === time);
    const details = () => {
        if (!name.trim()) { showToast(tr('Please enter your name')); return false; }
        if (phone.replace(/\D/g, '').length < 6) { showToast(tr('Please enter your phone number')); return false; }
        return true;
    };

    const send = async () => {
        if (!table) return showToast(tr('Tap a table'));
        if (!details()) return;
        setBusy(true);
        try {
            // the table is held while he pays the deposit; if he does not pay it is let go after a few minutes
            const { booking, pay } = await createBooking({ date, time, party, table, name: name.trim(), phone: phone.trim(), note: note.trim() });
            const r = await payBooking({ booking, pay, user: { phone: phone.trim() } });
            if (r.status === 'paid') showToast(tr('Table booked'));
            else showToast(r.status === 'pending' ? tr(r.message) : tr('Not paid yet. Your table is held for a few minutes: open My bookings to pay.'));
            nav.replace('MyBookings');
        } catch (e) {
            showToast(e?.response?.data?.error || tr('Could not book. Try again.'));
            if (e?.response?.status === 409) { setTable(''); loadTables(); loadSlots(); }   // someone was faster: show the map as it is now
        } finally { setBusy(false); }
    };

    const wait = async () => {
        if (!details()) return;
        setBusy(true);
        try {
            await joinWaitlist({ date, time, party, name: name.trim(), phone: phone.trim() });
            setWaits((await fetchMyWaitlist()).items || []);
            showToast(tr('You are on the waitlist. We will tell you if a table comes free.'));
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not join the waitlist')); if (e?.response?.status === 409) { loadSlots(); loadTables(); } } finally { setBusy(false); }
    };
    const unwait = async () => {
        setBusy(true);
        try { await leaveWaitlist(myWait._id); setWaits((await fetchMyWaitlist()).items || []); } catch (e) { showToast(tr('Could not leave the waitlist')); } finally { setBusy(false); }
    };

    const step = (n) => setParty((p) => Math.max(cfg.minParty, Math.min(cfg.maxParty, p + n)));
    const stepBtn = (n, icon) => (
        <Pressable onPress={() => step(n)} style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', backgroundColor: surface }}>
            <Ionicons name={icon} size={22} color={text} />
        </Pressable>
    );
    const legend = (color, label, fill) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14 }}>
            <View style={{ width: 14, height: 14, borderRadius: 4, borderWidth: 1.5, borderColor: color, backgroundColor: fill || 'transparent', marginRight: 6 }} />
            <Text style={{ color: muted, fontSize: 12 }}>{label}</Text>
        </View>
    );

    return (
        <FormPage title={tr('Book a table')} footer={<Button label={table ? tr('Pay ₹{n} deposit · Table {t}', { n: deposit, t: table }) : tr('Tap a table to book')} icon="calendar" busy={busy} disabled={!table} onPress={send} />}>
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
                    const waiting = waits.some((w) => w.date === date && w.time === s.time);
                    return (
                        <Pressable key={s.time} disabled={s.noFit} onPress={() => setTime(s.time)} style={{ minWidth: 84, marginRight: 8, marginBottom: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : surface, opacity: s.noFit ? 0.4 : 1 }}>
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 15 }}>{s.time}</Text>
                            <Text style={{ color: on ? onPrimary : s.full ? error : muted, fontSize: 10 }}>{waiting ? tr('Waiting') : s.noFit ? tr('Too big') : s.full ? tr('Full') : tr('{n} free', { n: s.free })}</Text>
                        </Pressable>
                    );
                })}
            </View>
            {time && tables === null ? <Text style={{ color: muted, marginVertical: 8 }}>{tr('Loading the tables...')}</Text> : null}
            {time && tables ? (
                <View style={{ marginTop: 6 }}>
                    <Label hint={tr('Tap a free table')}>{tr('Choose your table')}</Label>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>
                        {tables.map((t) => {
                            const on = t.no === table;
                            const free = t.state === 'free';
                            return (
                                <Pressable key={t.no} disabled={!free} onPress={() => setTable(on ? '' : t.no)} accessibilityLabel={tr('Table {t}, {n} seats', { t: t.no, n: t.seats })}
                                    style={{ width: 74, height: 74, marginRight: 10, marginBottom: 10, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? primary : free ? primary : border, backgroundColor: on ? primary : free ? surface : alpha(border, 0.35), opacity: free ? 1 : 0.55 }}>
                                    <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 20 }}>{t.no}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Ionicons name="people" size={12} color={on ? onPrimary : muted} />
                                        <Text style={{ color: on ? onPrimary : muted, fontSize: 12, marginLeft: 3 }}>{t.seats}</Text>
                                    </View>
                                    {t.state === 'taken' ? <Text style={{ position: 'absolute', top: 4, fontSize: 9, color: muted }}>{tr('Taken')}</Text> : null}
                                    {t.state === 'small' ? <Text style={{ position: 'absolute', top: 4, fontSize: 9, color: muted }}>{tr('Too small')}</Text> : null}
                                </Pressable>
                            );
                        })}
                    </View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                        {legend(primary, tr('Free'))}{legend(primary, tr('Your choice'), primary)}{legend(border, tr('Taken'), alpha(border, 0.35))}
                    </View>
                    {full ? (
                        <View style={{ backgroundColor: surface, borderRadius: 14, borderWidth: 1, borderColor: border, padding: 14, marginBottom: 8 }}>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Every table is taken at this time.')}</Text>
                            <Text style={{ color: muted, fontSize: 13, marginTop: 4 }}>{myWait ? tr('You are on the waitlist. We will tell you if a table comes free.') : tr('Join the waitlist and we will tell you if a table comes free.')}</Text>
                            <Button label={myWait ? tr('Leave the waitlist') : tr('Join the waitlist')} icon={myWait ? 'close' : 'notifications'} kind={myWait ? 'ghost' : 'primary'} busy={busy} onPress={myWait ? unwait : wait} style={{ marginTop: 10 }} />
                        </View>
                    ) : null}
                </View>
            ) : null}
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
                <TextBox label={tr('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} placeholder={tr('Birthday, high chair...')} last />
            </Group>
        </FormPage>
    );
}

