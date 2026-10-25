// A cook's or a waiter's days off and leave, on their own page (opened from Profile). Days off are a holiday you take yourself; leave is asked from
// the owner, who approves or rejects. Approved leave is added to the days off.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { istToday } from '../../utils/owners/txRules';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Sheet, Button, Pill } from '../../components/owners/ui';
import { showToast } from '../../components/customers/shop';
import { apiError } from '../../api/owners/shopApi';
import { fetchDuty, addDayOff, removeDayOff, askLeave, cancelLeave } from '../../api/staff/staffApi';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { onNotification } from '../../api/common/socket';
import { tr } from '../../i18n';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const todayKey = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plus = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nice = (ymd) => { const x = new Date(`${ymd}T00:00:00Z`); return `${WEEK[x.getUTCDay()]}, ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`; };
const range = (a, b) => (a === b ? nice(a) : `${nice(a)} to ${nice(b)}`);
const daysIn = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

function DayStep({ label, value, min, onChange }) {
    const { text, muted, border, primary } = useBrand();
    return (
        <View style={{ flex: 1 }}>
            <Text style={{ color: muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 4 }}>
                <Pressable disabled={value <= min} onPress={() => onChange(plus(value, -1))} hitSlop={8} style={{ padding: 6, opacity: value <= min ? 0.3 : 1 }}><Ionicons name="chevron-back" size={22} color={primary} /></Pressable>
                <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 14, textAlign: 'center' }}>{nice(value)}</Text>
                <Pressable onPress={() => onChange(plus(value, 1))} hitSlop={8} style={{ padding: 6 }}><Ionicons name="chevron-forward" size={22} color={primary} /></Pressable>
            </View>
        </View>
    );
}

function DaysOffSheet({ visible, onClose, onSubmit, leave }) {
    const { text, muted, border, background } = useBrand();
    const [from, setFrom] = useState(todayKey());
    const [to, setTo] = useState(todayKey());
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible) { setFrom(todayKey()); setTo(todayKey()); setNote(''); } }, [visible]);
    const go = async () => {
        if (leave && !note.trim()) { showToast(tr('Please write the reason')); return; }
        setBusy(true);
        try { await onSubmit({ from, to, note: note.trim() }); onClose(); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title={leave ? tr('Ask for leave') : tr('Add days off')}>
            <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{leave ? tr('The owner gets this request and approves or rejects it. You are told.') : tr('A holiday. No approval needed. You get no alerts on these days. The owner is told.')}</Text>
            <View style={{ flexDirection: 'row' }}>
                <DayStep label={tr('FROM')} value={from} min={leave ? plus(todayKey(), 0) : todayKey()} onChange={(v) => { setFrom(v); if (to < v) setTo(v); }} />
                <View style={{ width: 10 }} />
                <DayStep label={tr('LAST DAY')} value={to} min={from} onChange={setTo} />
            </View>
            <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>{daysIn(from, to)} {daysIn(from, to) === 1 ? tr('day') : tr('days')}</Text>
            <TextInput value={note} onChangeText={setNote} maxLength={80} placeholder={leave ? tr('Reason for your leave') : tr('Note (optional)')} placeholderTextColor={muted} multiline={!!leave} style={{ marginTop: 12, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, color: text, backgroundColor: background, minHeight: leave ? 76 : 46, textAlignVertical: leave ? 'top' : 'center' }} />
            <Button label={leave ? tr('Send request') : tr('Save days off')} icon="checkmark" busy={busy} onPress={go} style={{ marginTop: 16 }} />
        </Sheet>
    );
}

export default function StaffLeaveScreen() {
    const { background, text, muted, border, ok, warn, error } = useBrand();
    const [d, setD] = useState(null);
    const [offOpen, setOffOpen] = useState(false);
    const [leaveOpen, setLeaveOpen] = useState(false);

    const take = useCallback((r) => {
        setD(r);
        useStaffStore.getState().patchMe({ onDuty: r.onDuty, dutyStatus: r.status });
    }, []);
    useEffect(() => { fetchDuty().then(take).catch(() => { }); }, [take]);
    // the owner answered a leave or took it away: read it again
    useEffect(() => onNotification((n) => {
        if (['staff_leave_decision', 'staff_leave_removed', 'staff_holiday'].includes(String(n?.type))) fetchDuty().then(take).catch(() => { });
    }), [take]);

    const act = async (fn, msg) => { try { take(await fn()); if (msg) showToast(msg); } catch (e) { showToast(apiError(e)); } };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Days off and leave')} />
            {!d ? null : (
                <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                    <SectionTitle title={tr('Days off')} />
                    <Card>
                        <Text style={{ color: muted, fontSize: 12.5 }}>{tr('A holiday you take yourself. No approval needed. You get no alerts on these days.')}</Text>
                        {d.holidays.map((h) => (
                            <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12, marginTop: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: text, fontWeight: '800' }}>{range(h.from, h.to)}</Text>
                                    {h.note ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{h.note}</Text> : null}
                                </View>
                                {h.leave ? <Pill label={tr('Leave')} color={ok} /> : <Pressable onPress={() => act(() => removeDayOff(h.id))} hitSlop={10}><Ionicons name="trash-outline" size={20} color={error} /></Pressable>}
                            </View>
                        ))}
                        <Button label={tr('Add days off')} icon="add" kind="ghost" onPress={() => setOffOpen(true)} style={{ marginTop: 12 }} />
                    </Card>
                    <SectionTitle title={tr('Leave')} />
                    <Card>
                        <Text style={{ color: muted, fontSize: 12.5 }}>{tr('Ask the owner for leave. You are told when they decide. Approved leave is added to your days off.')}</Text>
                        {(d.leaves || []).map((l) => {
                            const tone = l.status === 'approved' ? ok : l.status === 'pending' ? warn : error;
                            return (
                                <View key={l.id} style={{ paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ flex: 1, color: text, fontWeight: '800' }}>{range(l.from, l.to)}</Text>
                                        <Pill label={tr(l.status === 'pending' ? 'Waiting' : l.status === 'approved' ? 'Approved' : l.status === 'rejected' ? 'Not approved' : 'Cancelled')} color={l.status === 'cancelled' ? muted : tone} />
                                    </View>
                                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 3 }}>{l.days} {l.days === 1 ? tr('day') : tr('days')}{l.reason ? ` · ${l.reason}` : ''}</Text>
                                    {l.note ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Shop: {note}', { note: l.note })}</Text> : null}
                                    {['pending', 'approved'].includes(l.status) && l.to >= istToday() ? (
                                        <Pressable onPress={() => act(() => cancelLeave(l.id), tr(l.status === 'pending' ? 'Request cancelled' : 'Leave cancelled'))} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                                            <Text style={{ color: error, fontWeight: '800', fontSize: 13 }}>{tr(l.status === 'pending' ? 'Cancel request' : 'Cancel this leave')}</Text>
                                        </Pressable>
                                    ) : null}
                                </View>
                            );
                        })}
                        <Button label={tr('Ask for leave')} icon="calendar-outline" kind="ghost" onPress={() => setLeaveOpen(true)} style={{ marginTop: 12 }} />
                    </Card>
                </ScrollView>
            )}
            <DaysOffSheet leave visible={leaveOpen} onClose={() => setLeaveOpen(false)} onSubmit={async ({ from, to, note }) => { take(await askLeave({ from, to, reason: note })); showToast(tr('Request sent to the owner')); }} />
            <DaysOffSheet visible={offOpen} onClose={() => setOffOpen(false)} onSubmit={async (b) => { take(await addDayOff(b)); showToast(tr('Saved. The owner is told.')); }} />
        </View>
    );
}
