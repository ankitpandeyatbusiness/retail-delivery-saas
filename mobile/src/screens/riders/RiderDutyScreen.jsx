// The rider's duty timing, holidays and leave.
//   Timing   Automatic = he is put on duty by himself when his time starts and off when it ends. Manual = he starts and ends duty himself.
//   Holidays days off he sets himself (no approval)
//   Leave    days off he asks the shop for; the owner approves or rejects. The days used this month are counted here and in the owner's app.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable, TextInput, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { onNotification } from '../../api/common/socket';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Sheet, Button, Chips, Pill } from '../../components/owners/ui';
import { TimeStep } from '../../components/owners/AutoAccept';
import { ListShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { fetchDuty, saveDuty, addHoliday, removeHoliday, requestLeave, cancelLeave } from '../../api/riders/riderApi';
import { errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const todayKey = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const plus = (ymd, n) => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const nice = (ymd) => { const d = new Date(`${ymd}T00:00:00Z`); return `${WEEK[d.getUTCDay()]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; };
const range = (a, b) => (a === b ? nice(a) : `${nice(a)} to ${nice(b)}`);
const daysIn = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;

// one day with arrows
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

// "from - to" days and a note: used for leave (the note is the reason) and for a holiday
function DaysSheet({ visible, onClose, title, hint, noteLabel, noteRequired, submitLabel, onSubmit }) {
    const { text, muted, border, background } = useBrand();
    const [from, setFrom] = useState(todayKey());
    const [to, setTo] = useState(todayKey());
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible) { setFrom(plus(todayKey(), 1)); setTo(plus(todayKey(), 1)); setNote(''); } }, [visible]);
    const go = async () => {
        if (noteRequired && !note.trim()) { showToast(tr('Please write the reason')); return; }
        setBusy(true);
        try { await onSubmit({ from, to, note: note.trim() }); onClose(); } catch (e) { showToast(errText(e)); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title={title}>
            {hint ? <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{hint}</Text> : null}
            <View style={{ flexDirection: 'row' }}>
                <DayStep label={tr('FROM')} value={from} min={todayKey()} onChange={(v) => { setFrom(v); if (to < v) setTo(v); }} />
                <View style={{ width: 10 }} />
                <DayStep label={tr('LAST DAY')} value={to} min={from} onChange={setTo} />
            </View>
            <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>{daysIn(from, to)} {daysIn(from, to) === 1 ? tr('day') : tr('days')}</Text>
            <TextInput
                value={note} onChangeText={setNote} maxLength={noteLabel === 'reason' ? 200 : 80} multiline={noteLabel === 'reason'}
                placeholder={noteLabel === 'reason' ? tr('Reason for your leave') : tr('Note (optional)')} placeholderTextColor={muted}
                style={{ marginTop: 12, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, color: text, backgroundColor: background, minHeight: noteLabel === 'reason' ? 76 : 46, textAlignVertical: noteLabel === 'reason' ? 'top' : 'center' }}
            />
            <Button label={submitLabel} icon="checkmark" busy={busy} onPress={go} style={{ marginTop: 16 }} />
        </Sheet>
    );
}

const STATUS = { pending: ['Waiting', 'warn'], approved: ['Approved', 'ok'], rejected: ['Not approved', 'error'] };

export default function RiderDutyScreen() {
    const { background, text, muted, border, primary, ok, error, warn } = useBrand();
    const colors = { ok, error, warn };
    const [d, setD] = useState(null);
    const [weekly, setWeekly] = useState(null);
    const [mode, setMode] = useState('manual');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [leaveOpen, setLeaveOpen] = useState(false);
    const [holOpen, setHolOpen] = useState(false);

    const take = useCallback((r, keepEdits) => {
        setD(r);
        if (!keepEdits) { setWeekly(r.weekly); setMode(r.mode); setDirty(false); }
    }, []);
    const load = useCallback(async () => { try { take(await fetchDuty(), dirty); } catch (e) { showToast(errText(e)); } }, [take, dirty]);
    useFocusEffect(useCallback(() => {
        load();
        // the shop answered a leave, or put him on or off duty: the page changes at once
        return onNotification((n) => { if (['rider_leave_decision', 'rider_duty_auto', 'rider_off_duty', 'rider_removed'].includes(String(n?.type))) load(); });
    }, [])); // eslint-disable-line react-hooks/exhaustive-deps

    const setDay = (k, patch) => { setWeekly((w) => ({ ...w, [k]: { ...w[k], ...patch } })); setDirty(true); };
    const save = async () => {
        setSaving(true);
        try { take(await saveDuty({ mode, weekly })); showToast(mode === 'auto' ? tr('Saved. You will go on and off duty by yourself') : tr('Saved. You start and end duty by hand')); } catch (e) { showToast(errText(e)); } finally { setSaving(false); }
    };
    const act = async (fn, msg) => { try { take(await fn(), true); if (msg) showToast(msg); } catch (e) { showToast(errText(e)); } };

    if (!d || !weekly) {
        return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Duty and leave')} /><ListShimmer count={3} /></View>;
    }
    const leaveLine = d.month.leaveDays === 0 ? tr('No leave taken this month') : `${d.month.leaveDays} ${d.month.leaveDays === 1 ? tr('day') : tr('days')} ${tr('of leave this month')}`;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Duty and leave')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
                {d.today.onLeave || d.today.holiday ? (
                    <Card tone={warn}>
                        <Text style={{ color: warn, fontWeight: '900' }}>{d.today.onLeave ? tr('You are on leave today') : tr('Today is your holiday')}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Automatic duty will not start today.')}</Text>
                    </Card>
                ) : null}

                <SectionTitle title={tr('Duty timing')} />
                <Card>
                    <Chips options={[['auto', tr('Automatic')], ['manual', tr('Manual')]]} value={mode} onChange={(v) => { setMode(v); setDirty(true); }} style={{ marginTop: 0 }} />
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 10 }}>
                        {mode === 'auto'
                            ? tr('You go on duty by yourself when your time starts and off duty when it ends. You can still end duty by hand any time. Holidays and approved leave are skipped.')
                            : tr('You start and end duty yourself from the Home tab, as usual.')}
                    </Text>
                    {mode === 'auto' ? (
                        <View style={{ marginTop: 6 }}>
                            {DAYS.map(([k, name]) => {
                                const day = weekly[k];
                                return (
                                    <View key={k} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7), marginTop: 6 }}>
                                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                            <Text style={{ flex: 1, color: day.on ? text : muted, fontWeight: '800', fontSize: 15 }}>{tr(name)}</Text>
                                            <Text style={{ color: muted, fontSize: 12, marginRight: 8 }}>{day.on ? tr('Working') : tr('Day off')}</Text>
                                            <Switch value={day.on} onValueChange={(v) => setDay(k, { on: v })} trackColor={{ true: alpha(primary, 0.5), false: undefined }} thumbColor={day.on ? primary : undefined} />
                                        </View>
                                        {day.on ? (
                                            <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                                <TimeStep label={tr('FROM')} value={day.from} onChange={(v) => setDay(k, { from: v })} />
                                                <View style={{ width: 10 }} />
                                                <TimeStep label={tr('UNTIL')} value={day.to} onChange={(v) => setDay(k, { to: v })} />
                                            </View>
                                        ) : null}
                                    </View>
                                );
                            })}
                        </View>
                    ) : null}
                    {dirty ? <Button label={tr('Save timing')} icon="checkmark" busy={saving} onPress={save} style={{ marginTop: 14 }} /> : null}
                </Card>

                <SectionTitle title={tr('Leave')} />
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{leaveLine}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Your shop approves or rejects each request.')}</Text>
                        </View>
                        {d.month.pending ? <Pill label={`${d.month.pending} ${tr('waiting')}`} color={warn} /> : null}
                    </View>
                    <Button label={tr('Ask for leave')} icon="calendar-outline" kind="ghost" onPress={() => setLeaveOpen(true)} style={{ marginTop: 12 }} />
                    {d.leaves.map((l) => {
                        const [label, tone] = STATUS[l.status] || STATUS.pending;
                        return (
                            <View key={l.id} style={{ paddingTop: 12, marginTop: 12, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ flex: 1, color: text, fontWeight: '800' }}>{range(l.from, l.to)}</Text>
                                    <Pill label={tr(label)} color={colors[tone]} />
                                </View>
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 3 }}>{l.days} {l.days === 1 ? tr('day') : tr('days')}{l.reason ? ` · ${l.reason}` : ''}</Text>
                                {l.note ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Shop: {note}', { note: l.note })}</Text> : null}
                                {l.status === 'pending' ? (
                                    <Pressable onPress={() => act(() => cancelLeave(l.id), tr('Request cancelled'))} hitSlop={8} style={{ alignSelf: 'flex-start', marginTop: 6 }}>
                                        <Text style={{ color: error, fontWeight: '800', fontSize: 13 }}>{tr('Cancel request')}</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                        );
                    })}
                </Card>

                <SectionTitle title={tr('My holidays')} />
                <Card>
                    <Text style={{ color: muted, fontSize: 12.5 }}>{tr('Days you will not work. No approval needed. Automatic duty skips them.')}</Text>
                    {d.holidays.map((h) => (
                        <View key={h.id} style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 12, marginTop: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                            <View style={{ flex: 1 }}>
                                <Text style={{ color: text, fontWeight: '800' }}>{range(h.from, h.to)}</Text>
                                {h.note ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{h.note}</Text> : null}
                            </View>
                            <Pressable onPress={() => act(() => removeHoliday(h.id))} hitSlop={10}><Ionicons name="trash-outline" size={20} color={error} /></Pressable>
                        </View>
                    ))}
                    <Button label={tr('Add a holiday')} icon="add" kind="ghost" onPress={() => setHolOpen(true)} style={{ marginTop: 12 }} />
                </Card>
            </ScrollView>

            <DaysSheet
                visible={leaveOpen} onClose={() => setLeaveOpen(false)} title={tr('Ask for leave')} noteLabel="reason" noteRequired submitLabel={tr('Send request')}
                hint={tr('Your shop gets this request and will approve or reject it.')}
                onSubmit={async ({ from, to, note }) => { take(await requestLeave({ from, to, reason: note }), true); showToast(tr('Request sent to your shop')); }}
            />
            <DaysSheet
                visible={holOpen} onClose={() => setHolOpen(false)} title={tr('Add a holiday')} noteLabel="note" submitLabel={tr('Save holiday')}
                onSubmit={async ({ from, to, note }) => { take(await addHoliday({ from, to, note }), true); showToast(tr('Holiday saved')); }}
            />
        </View>
    );
}
