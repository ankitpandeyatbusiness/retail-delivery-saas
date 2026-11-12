// Reserve a table, cinema style: pick the day, the group, the time, then tap a TABLE on the map. A table someone else has is greyed out. The deposit is
// shown before you pay. When every table of a time is taken you can join the waitlist and are told if one comes free.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Button, Empty, PageHeader } from '../../components/owners/ui';
import { FormPage, Group, TextBox, Label } from '../../components/owners/menuBits';
import { fetchBookingConfig, fetchBookingSlots, fetchBookingTables, createBooking, joinWaitlist, leaveWaitlist, fetchMyWaitlist } from '../../api/customers/shopApi';
import { FormShimmer, LineShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { ease } from '../../utils/common/ease';
import { tr } from '../../i18n';
import { weekdayShort } from '../../utils/common/dayNames';
import { useIsDesktopWeb } from '../../utils/common/layout';

const plus = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const dayLabel = (ymd) => weekdayShort(ymd);
const niceDay = (ymd) => `${weekdayShort(ymd)} ${ymd.slice(8)}`;

export default function BookTableScreen() {
    const nav = useNavigation();
    const { text, muted, primary, onPrimary, border, surface, error, background } = useBrand();
    const desk = useIsDesktopWeb();   // the desktop website: the choices on the left, the table map and the booking on the right (false in the phone app)
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
        return fetchBookingSlots(date, party).then((r) => { ease(); setSlots(r.slots); setDeposit(r.deposit); }).catch(() => setSlots([]));
    }, [cfg, date, party]);
    const loadTables = useCallback(() => {
        if (!cfg?.enabled || !date || !time) return Promise.resolve();
        return fetchBookingTables(date, time, party).then((r) => { ease(); setTables(r.tables); setDeposit(r.deposit); setTable((cur) => (r.tables.some((t) => t.no === cur && t.state === 'free') ? cur : ''));   // a table taken meanwhile is dropped
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

    if (!cfg) return <FormPage title={tr('Reserve a table')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    if (cfg.blocked) return <FormPage title={tr('Reserve a table')}><Empty icon="ban-outline" title={tr('Not available')} hint={tr('Reservations are not available for you at this restaurant. Please call the restaurant.')} /></FormPage>;
    if (!cfg.enabled) return <FormPage title={tr('Reserve a table')}><Empty icon="calendar-outline" title={tr('Booking is closed')} hint={tr('This shop is not taking table bookings right now.')} /></FormPage>;

    const days = cfg.dates?.length ? cfg.dates : Array.from({ length: Math.min(cfg.advanceDays, 30) + 1 }, (_, i) => plus(cfg.today, i));   // today and the next working days (the server counts them)
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
            nav.navigate('PaymentMethods', { deposit: { booking, pay }, current: 'upi' });   // he picks a UPI app or card; the table stays held meanwhile
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

    if (desk) {
        const panel = { borderRadius: 24, borderWidth: 1, borderColor: border, backgroundColor: surface, padding: 24, marginBottom: 18 };
        const head = (icon, title, sub) => (
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={icon} size={20} color={primary} /></View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={{ color: text, fontSize: 18, fontWeight: '900' }}>{title}</Text>
                    {sub ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }}>{sub}</Text> : null}
                </View>
            </View>
        );
        const chip = (on, disabled) => (h) => ({
            borderWidth: 1.5, borderColor: on || (h && !disabled) ? primary : border, backgroundColor: on ? primary : h && !disabled ? alpha(primary, 0.1) : 'transparent', opacity: disabled ? 0.45 : 1,
            cursor: disabled ? 'default' : 'pointer', boxShadow: h && !on && !disabled ? `0 6px 16px ${alpha(primary, 0.22)}` : '0 0 0 rgba(0,0,0,0)', transform: [{ translateY: h && !on && !disabled ? -2 : 0 }], transitionProperty: 'background-color, border-color, box-shadow, transform', transitionDuration: '170ms',
        });
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Reserve a table')} right={<Button label={tr('My reservations')} icon="calendar-number-outline" kind="ghost" onPress={() => nav.navigate('MyBookings')} style={{ minWidth: 190 }} />} />
                <View style={{ flex: 1, flexDirection: 'row', width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 12, gap: 28 }}>
                    {/* LEFT: the day, the guests and the time */}
                    <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
                        <View style={panel}>
                            {head('calendar-outline', tr('Day'), tr('Today and the days you can book'))}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                                {days.map((x) => {
                                    const on = x === date;
                                    return (
                                        <Pressable key={x} onPress={() => setDate(x)} style={({ hovered }) => [{ width: 70, paddingVertical: 12, borderRadius: 16, alignItems: 'center' }, chip(on, false)(hovered)]}>
                                            <Text style={{ color: on ? onPrimary : muted, fontSize: 12.5 }}>{x === cfg.today ? tr('Today') : dayLabel(x)}</Text>
                                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 20 }}>{x.slice(8)}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={panel}>
                            {head('people-outline', tr('Guests'), tr('How many will sit at the table'))}
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                {stepBtn(-1, 'remove')}
                                <Text style={{ color: text, fontWeight: '900', fontSize: 30, minWidth: 90, textAlign: 'center' }}>{party}</Text>
                                {stepBtn(1, 'add')}
                            </View>
                        </View>

                        <View style={panel}>
                            {head('time-outline', tr('Time'), tr('Pick a time to see the tables'))}
                            {slots === null ? (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ marginRight: 10, marginBottom: 10 }}><LineShimmer width={96} height={54} /></View>)}</View>
                            ) : null}
                            {slots && !slots.length ? <Text style={{ color: muted }}>{tr('No times on this day. Try another day.')}</Text> : null}
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                                {(slots || []).map((sl) => {
                                    const on = sl.time === time;
                                    const waiting = waits.some((w) => w.date === date && w.time === sl.time);
                                    return (
                                        <Pressable key={sl.time} disabled={sl.noFit} onPress={() => { ease(); setTime(sl.time); }} style={({ hovered }) => [{ minWidth: 100, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, alignItems: 'center' }, chip(on, sl.noFit)(hovered)]}>
                                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 16 }}>{sl.time}</Text>
                                            <Text style={{ color: on ? onPrimary : sl.full ? error : muted, fontSize: 11 }}>{waiting ? tr('Waiting') : sl.noFit ? tr('Too big') : sl.full ? tr('Full') : tr('{n} free', { n: sl.free })}</Text>
                                        </Pressable>
                                    );
                                })}
                            </View>
                        </View>

                        <View style={[panel, { borderColor: alpha(primary, 0.4) }]}>
                            <Text style={{ color: primary, fontWeight: '900', fontSize: 20 }}>{tr('Deposit ₹{n}', { n: deposit || d.amount })}</Text>
                            <Text style={{ color: muted, fontSize: 14, marginTop: 6, lineHeight: 20 }}>{d.type === 'per_person' ? tr('₹{a} per person. ', { a: d.amount }) : ''}{d.mode === 'adjust' ? tr('It is taken off your bill.') : tr('The restaurant keeps it.')}</Text>
                            <Text style={{ color: muted, fontSize: 14, marginTop: 2 }}>{tr('Full refund if you cancel at least {h} hours before.', { h: d.refundHours })}</Text>
                        </View>
                    </ScrollView>

                    {/* RIGHT: the tables, then your details and the button */}
                    <ScrollView style={{ width: 470, flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
                        <View style={panel}>
                            {head('restaurant-outline', tr('Choose your table'), time ? tr('Tap a free table') : tr('Pick a day, guests and a time first'))}
                            {!time ? (
                                <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                                    <Ionicons name="grid-outline" size={46} color={alpha(muted, 0.6)} />
                                    <Text style={{ color: muted, marginTop: 10, textAlign: 'center' }}>{tr('The tables of that time show here')}</Text>
                                </View>
                            ) : null}
                            {time && tables === null ? (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <View key={i} style={{ marginRight: 12, marginBottom: 12 }}><LineShimmer width={88} height={88} /></View>)}</View>
                            ) : null}
                            {time && tables ? (
                                <>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                                        {tables.map((t) => {
                                            const on = t.no === table;
                                            const free = t.state === 'free';
                                            return (
                                                <Pressable key={t.no} disabled={!free} onPress={() => setTable(on ? '' : t.no)} accessibilityLabel={tr('Table {t}, {n} seats', { t: t.no, n: t.seats })}
                                                    style={({ hovered }) => [{ width: 88, height: 88, borderRadius: 18, alignItems: 'center', justifyContent: 'center' }, chip(on, !free)(hovered), !free && { backgroundColor: alpha(border, 0.35), borderColor: border }]}>
                                                    <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 24 }}>{t.no}</Text>
                                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                                        <Ionicons name="people" size={13} color={on ? onPrimary : muted} />
                                                        <Text style={{ color: on ? onPrimary : muted, fontSize: 12.5, marginLeft: 3 }}>{t.seats}</Text>
                                                    </View>
                                                    {t.state === 'taken' ? <Text style={{ position: 'absolute', top: 5, fontSize: 9.5, color: muted }}>{tr('Taken')}</Text> : null}
                                                    {t.state === 'small' ? <Text style={{ position: 'absolute', top: 5, fontSize: 9.5, color: muted }}>{tr('Too small')}</Text> : null}
                                                </Pressable>
                                            );
                                        })}
                                    </View>
                                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 16 }}>{legend(primary, tr('Free'))}{legend(primary, tr('Your choice'), primary)}{legend(border, tr('Taken'), alpha(border, 0.35))}</View>
                                    {full ? (
                                        <View style={{ backgroundColor: background, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 16, marginTop: 14 }}>
                                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Every table is taken at this time.')}</Text>
                                            <Text style={{ color: muted, fontSize: 13, marginTop: 4 }}>{myWait ? tr('You are on the waitlist. We will tell you if a table comes free.') : tr('Join the waitlist and we will tell you if a table comes free.')}</Text>
                                            <Button label={myWait ? tr('Leave the waitlist') : tr('Join the waitlist')} icon={myWait ? 'close' : 'notifications'} kind={myWait ? 'ghost' : 'primary'} busy={busy} onPress={myWait ? unwait : wait} style={{ marginTop: 10 }} />
                                        </View>
                                    ) : null}
                                </>
                            ) : null}
                        </View>

                        <View style={panel}>
                            {head('person-outline', tr('Your details'))}
                            <Group title="">
                                <TextBox label={tr('Your name')} value={name} onChangeText={setName} maxLength={80} />
                                <TextBox label={tr('Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
                                <TextBox label={tr('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} placeholder={tr('Birthday, high chair...')} last />
                            </Group>
                            {table ? (
                                <View style={{ marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: alpha(primary, 0.1) }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{niceDay(date)} · {time} · {tr('{n} guests', { n: party })} · {tr('Table {t}', { t: table })}</Text>
                                </View>
                            ) : null}
                            <Button label={table ? tr('Pay ₹{n} deposit · Table {t}', { n: deposit, t: table }) : tr('Tap a table to book')} icon="calendar" busy={busy} disabled={!table} onPress={send} style={{ marginTop: 16, minHeight: 56 }} />
                        </View>
                    </ScrollView>
                </View>
            </View>
        );
    }

    return (
        <FormPage title={tr('Reserve a table')} footer={<Button label={table ? tr('Pay ₹{n} deposit · Table {t}', { n: deposit, t: table }) : tr('Tap a table to book')} icon="calendar" busy={busy} disabled={!table} onPress={send} />}>
            <View style={{ paddingHorizontal: 16 }}>
            <Button label={tr('My reservations')} icon="calendar-number-outline" kind="ghost" onPress={() => nav.navigate('MyBookings')} style={{ marginBottom: 10 }} />
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
            {slots === null ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
                    {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={{ marginRight: 8, marginBottom: 8 }}><LineShimmer width={84} height={48} /></View>)}
                </View>
            ) : null}
            {slots && !slots.length ? <Text style={{ color: muted, marginBottom: 14 }}>{tr('No times on this day. Try another day.')}</Text> : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 6 }}>
                {(slots || []).map((s) => {
                    const on = s.time === time;
                    const waiting = waits.some((w) => w.date === date && w.time === s.time);
                    return (
                        <Pressable key={s.time} disabled={s.noFit} onPress={() => { ease(); setTime(s.time); }} style={{ minWidth: 84, marginRight: 8, marginBottom: 8, paddingVertical: 11, paddingHorizontal: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : surface, opacity: s.noFit ? 0.4 : 1 }}>
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 15 }}>{s.time}</Text>
                            <Text style={{ color: on ? onPrimary : s.full ? error : muted, fontSize: 10 }}>{waiting ? tr('Waiting') : s.noFit ? tr('Too big') : s.full ? tr('Full') : tr('{n} free', { n: s.free })}</Text>
                        </Pressable>
                    );
                })}
            </View>
            {time && tables === null ? (
                <View style={{ marginTop: 6 }}>
                    <View style={{ marginBottom: 10 }}><LineShimmer width={140} height={16} /></View>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <View key={i} style={{ marginRight: 10, marginBottom: 10 }}><LineShimmer width={74} height={74} /></View>)}
                    </View>
                </View>
            ) : null}
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
            </View>
            <Group title={tr('Your details')}>
                <TextBox label={tr('Your name')} value={name} onChangeText={setName} maxLength={80} />
                <TextBox label={tr('Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
                <TextBox label={tr('Note (optional)')} value={note} onChangeText={setNote} maxLength={300} placeholder={tr('Birthday, high chair...')} last />
            </Group>
        </FormPage>
    );
}

