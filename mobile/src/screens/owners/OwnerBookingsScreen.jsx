// Bookings: one day at a time, or all of them with a date filter. Filter by time of day and by status. Mark a guest seated or a no-show, or cancel a booking.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, ScrollView, Linking } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Empty } from '../../components/owners/ui';
import DateRangeSheet, { rangeLabel } from '../../components/customers/DateRangeSheet';
import { ListShimmer } from '../../components/owners/shimmer';
import { booking as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { shareBookingReceipt, hasReceipt } from '../../utils/customers/shareBookingReceipt';
import { tr } from '../../i18n';

export const BOOKING_STATUS = { held: 'Waiting for payment', confirmed: 'Booked', seated: 'Seated', no_show: 'No-show', cancelled: 'Cancelled', expired: 'Expired' };
// what became of the deposit, in words (guest and owner screens)
export const DEPOSIT_STATUS = { unpaid: 'Deposit not paid', paid: 'Deposit paid', refunding: 'Refund on its way', refund_failed: 'Refund on its way', refunded: 'Deposit refunded', kept: 'Deposit kept by the restaurant', adjusted: 'Deposit taken off the bill' };
const shift = (ymd, n) => new Date(new Date(`${ymd}T12:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);
const todayIst = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const nice = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

export default function OwnerBookingsScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, onPrimary, ok, error, border, surface } = useBrand();
    const [mode, setMode] = useState('day');          // 'day' one day at a time, 'all' every booking of the chosen dates
    const [range, setRange] = useState(null);         // { from, to, sort } for 'all'
    const [pickRange, setPickRange] = useState(false);
    const [slot, setSlot] = useState('any');          // time of day
    const [state, setState] = useState('all');        // status
    const [date, setDate] = useState(todayIst());
    const [data, setData] = useState(null);
    const [busyId, setBusyId] = useState('');
    const [receiptId, setReceiptId] = useState('');

    const load = useCallback(() => (mode === 'all' ? api.all({ from: range?.from, to: range?.to, sort: range?.sort }) : api.day(date)).then((r) => setData(r)).catch((e) => { useOwnerStore.getState().noteError(e); showToast(apiError(e)); setData((x) => x || { items: [], seats: 0, upcoming: 0 }); }), [date, mode, range]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => onNotification((n) => { if (['booking_new', 'booking_cancelled'].includes(String(n?.type))) load(); }), [load]);

    const undo = async (b) => {
        setBusyId(b._id);
        try { await api.undo(b._id); showToast(tr('Done. The booking is back as it was.')); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const blockGuest = async (b) => {
        const yes = await ask({ title: tr('Block {n} from reserving?', { n: b.name }), message: tr('They can still order food, but cannot reserve a table. Reservations they already have stay. You can unblock them in Booking settings.'), confirmText: tr('Block'), destructive: true });
        if (!yes) return;
        setBusyId(b._id);
        try { await api.block(b._id); showToast(tr('Blocked from reserving')); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const started = (b) => new Date(b.startsAt).getTime() <= Date.now();
    const allow = async (b) => {
        setBusyId(b._id);
        try { await api.allow(b._id); showToast(tr('The guest is told the table is confirmed')); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const freeIt = async (b) => {
        setBusyId(b._id);
        try { await api.free(b._id); showToast(tr('The table is free for other guests')); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const adjust = async (b) => {
        setBusyId(b._id);
        try { await api.adjusted(b._id); await load(); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const act = async (b, kind) => {
        if (kind === 'cancel') {
            const yes = await ask({ title: tr('Cancel this booking?'), message: tr('{n} will be told. The seats are free again.', { n: b.name }), confirmText: tr('Cancel booking'), destructive: true });
            if (!yes) return;
        }
        setBusyId(b._id);
        try { await (kind === 'seat' ? api.seat(b._id) : kind === 'noshow' ? api.noShow(b._id) : api.cancel(b._id)); await load(); }
        catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const hour = (b) => Number(String(b.time || '0').slice(0, 2));
    const inSlot = (b) => slot === 'any' || (slot === 'morning' ? hour(b) < 12 : slot === 'afternoon' ? hour(b) >= 12 && hour(b) < 17 : hour(b) >= 17);
    const shown = (data?.items || []).filter((b) => inSlot(b) && (state === 'all' || b.status === state));
    const chip = (label, on, onPress, key) => (
        <Pressable key={key || label} onPress={onPress} style={{ marginRight: 8, paddingHorizontal: 16, height: 38, justifyContent: 'center', borderRadius: 19, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : surface }}>
            <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
        </Pressable>
    );
    const tone = (s) => (s === 'seated' ? ok : s === 'confirmed' ? primary : s === 'no_show' ? error : muted);
    const arrow = (n, icon) => <Pressable onPress={() => { setData(null); setDate((d) => shift(d, n)); }} hitSlop={10} style={{ padding: 8 }}><Ionicons name={icon} size={22} color={text} /></Pressable>;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Reservations')} />
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 10 }}>
                {[['day', 'By day'], ['all', 'All bookings']].map(([k, l]) => (
                    <Pressable key={k} onPress={() => { if (mode !== k) { setData(null); setMode(k); } }} style={{ flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 3, borderBottomColor: mode === k ? primary : border }}>
                        <Text style={{ color: mode === k ? primary : muted, fontWeight: '900' }}>{tr(l)}</Text>
                    </Pressable>
                ))}
            </View>
            {mode === 'day' ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12 }}>
                    {arrow(-1, 'chevron-back')}
                    <Pressable onPress={() => { setData(null); setDate(todayIst()); }} style={{ alignItems: 'center', flex: 1 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{date === todayIst() ? tr('Today') : nice(date)}</Text>
                        <Text style={{ color: muted, fontSize: 12, textAlign: 'center' }}>{data ? tr('{n} guests booked', { n: data.seats }) + (data.waiting ? ` · ${tr('{n} waiting for a table', { n: data.waiting })}` : '') : ' '}</Text>
                    </Pressable>
                    {arrow(1, 'chevron-forward')}
                </View>
            ) : (
                <View style={{ paddingHorizontal: 16 }}>
                    <Pressable onPress={() => setPickRange(true)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 14 }}>
                        <Ionicons name="calendar-outline" size={18} color={primary} style={{ marginRight: 10 }} />
                        <Text style={{ flex: 1, color: range?.from ? text : muted, fontWeight: '700' }}>{range?.from ? rangeLabel(range) : tr('All dates. Tap to pick dates')}</Text>
                        {range?.from ? <Pressable onPress={() => { setData(null); setRange(null); }} hitSlop={10}><Ionicons name="close-circle" size={20} color={muted} /></Pressable> : <Ionicons name="chevron-down" size={18} color={muted} />}
                    </Pressable>
                </View>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 38, marginTop: 12 }} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
                {[['any', 'Any time'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']].map(([k, l]) => chip(tr(l), slot === k, () => setSlot(k), `t${k}`))}
            </ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0, height: 38, marginTop: 10, marginBottom: 8 }} contentContainerStyle={{ paddingHorizontal: 16, alignItems: 'center' }}>
                {[['all', 'All'], ['confirmed', 'Booked'], ['seated', 'Seated'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']].map(([k, l]) => chip(tr(l), state === k, () => setState(k), `s${k}`))}
            </ScrollView>
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {data === null ? <ListShimmer /> : null}
                {data && !shown.length ? <Empty icon="calendar-outline" title={mode === 'all' || slot !== 'any' || state !== 'all' ? tr('No bookings match') : tr('No bookings this day')} hint={mode === 'day' && data.upcoming && slot === 'any' && state === 'all' ? tr('{n} more are coming on other days.', { n: data.upcoming }) : tr('Bookings guests make will appear here.')} /> : null}
                {data?.truncated ? <Text style={{ color: muted, fontSize: 12, textAlign: 'center', marginBottom: 6 }}>{tr('Showing the first 300. Pick fewer dates to see the rest.')}</Text> : null}
                {shown.map((b) => (
                    <Card key={b._id} style={{ opacity: b.status === 'cancelled' ? 0.6 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                            <View style={{ flex: 1, minWidth: 140, paddingRight: 8 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 20 }}>{mode === 'all' ? `${nice(b.date)} · ` : ''}{b.time}</Text>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 16, marginTop: 2 }}>{b.name}</Text>
                            </View>
                            <Pill label={tr(BOOKING_STATUS[b.status])} color={tone(b.status)} />
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                            {[tr('{n} guests', { n: b.party }), b.table ? tr('Table {t}', { t: b.table }) : tr('No table'), b.phone, `${tr('Code')} ${b.code}`].map((x) => (
                                <View key={x} style={{ marginRight: 6, marginBottom: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
                                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{x}</Text>
                                </View>
                            ))}
                        </View>
                        {b.note ? <Text style={{ color: text, marginTop: 4 }}>{b.note}</Text> : null}
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('₹{n}', { n: b.deposit?.amount || 0 })} · {tr(DEPOSIT_STATUS[b.deposit?.status] || 'Deposit paid')}</Text>
                        {hasReceipt(b) ? <Button label={tr('Receipt')} icon="document-text-outline" kind="ghost" busy={receiptId === b._id} onPress={() => shareBookingReceipt(`/shop/booking/${b._id}/receipt`, b.code, (on) => setReceiptId(on ? b._id : ''))} style={{ marginTop: 10 }} /> : null}
                        {b.status === 'seated' && !b.freedAt && new Date(b.endsAt) > new Date() ? <Button label={tr('Guest left: table is free now')} icon="log-out-outline" kind="ghost" busy={busyId === b._id} onPress={() => freeIt(b)} style={{ marginTop: 10 }} /> : null}
                        {b.status === 'seated' && b.deposit?.credit === 'pending' ? (
                            <View style={{ marginTop: 10, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: primary }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{tr('Take ₹{n} off the table bill of this guest', { n: b.deposit.amount })}</Text>
                                <Button label={tr('Done, taken off the bill')} icon="checkmark" busy={busyId === b._id} onPress={() => adjust(b)} style={{ marginTop: 8 }} />
                            </View>
                        ) : null}
                        {b.status === 'confirmed' && !b.approvedAt ? <Button label={tr('Allow this booking')} icon="checkmark-done" kind="ghost" busy={busyId === b._id} onPress={() => allow(b)} style={{ marginTop: 10 }} /> : null}
                        {b.status === 'confirmed' && b.approvedAt ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                <Text style={{ color: ok, fontWeight: '800', flex: 1 }}>{tr('You allowed this booking')}</Text>
                                <Pressable onPress={() => undo(b)} disabled={busyId === b._id} hitSlop={8}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Undo')}</Text></Pressable>
                            </View>
                        ) : null}
                        {(b.status === 'seated' && !b.freedAt && b.deposit?.status !== 'adjusted') || b.status === 'no_show' ? (
                            <Button label={b.status === 'seated' ? tr('Undo seated') : tr('Undo no-show')} icon="arrow-undo" kind="ghost" busy={busyId === b._id} onPress={() => undo(b)} style={{ marginTop: 10 }} />
                        ) : null}
                        {b.status === 'cancelled' && b.cancelNote ? <Text style={{ color: muted, marginTop: 8 }}>{tr('Your message: {m}', { m: b.cancelNote })}</Text> : null}
                        {b.status === 'confirmed' ? (
                            <View style={{ marginTop: 10 }}>
                                {b.approvedAt && started(b) ? (
                                    <View style={{ flexDirection: 'row' }}>
                                        <Button label={tr('Seated')} icon="checkmark" busy={busyId === b._id} onPress={() => act(b, 'seat')} style={{ flex: 1, marginRight: 8 }} />
                                        <Button label={tr('No-show')} kind="ghost" busy={busyId === b._id} onPress={() => act(b, 'noshow')} style={{ flex: 1 }} />
                                    </View>
                                ) : b.approvedAt ? <Text style={{ color: muted, fontSize: 12.5 }}>{tr('Seated and No-show are available from {t}.', { t: b.time })}</Text> : null}
                                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                    <Button label={tr('Call')} icon="call" iconOnly kind="ghost" onPress={() => Linking.openURL(`tel:${String(b.phone).replace(/\D/g, '')}`)} style={{ width: 56, marginRight: 8 }} />
                                    <Button label={tr('Deny')} icon="close" kind="danger" busy={busyId === b._id} onPress={() => nav.navigate('OwnerBookingDeny', { id: String(b._id) })} style={{ flex: 1 }} />
                                </View>
                            </View>
                        ) : null}
                        {b.userId ? (
                            <Pressable onPress={() => blockGuest(b)} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 12, flexDirection: 'row', alignItems: 'center' }}>
                                <Ionicons name="ban-outline" size={16} color={error} style={{ marginRight: 6 }} />
                                <Text style={{ color: error, fontWeight: '800', fontSize: 13 }}>{tr('Block this guest from reserving')}</Text>
                            </Pressable>
                        ) : null}
                    </Card>
                ))}
                <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
                    <Button label={tr('Scan booking')} icon="qr-code-outline" onPress={() => nav.navigate('BookingScan', { who: 'owner' })} style={{ marginBottom: 8 }} />
                    <Button label={tr('Booking settings')} icon="settings-outline" kind="ghost" onPress={() => nav.navigate('OwnerBookingSettings')} />
                </View>
            </ScrollView>
            <DateRangeSheet visible={pickRange} value={range} ahead={365} noun="bookings" title={tr('Filter by date')} onClose={() => setPickRange(false)} onApply={(v) => { setPickRange(false); setData(null); setRange(v); }} />
        </View>
    );
}
