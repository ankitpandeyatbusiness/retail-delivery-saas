// A cook's or a waiter's own working time, on the Profile page: Go live, hours (by hand or by the clock) and days off (a holiday or leave).
// Alerts (the ting-tong and the push) reach only people on duty. Nothing here hides the orders: an off-duty person can still open the app.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import SlideSwitch from '../common/SlideSwitch';
import { istToday } from '../../utils/owners/txRules';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Card, SectionTitle, Sheet, Button, Chips, Pill } from '../owners/ui';
import { TimeStep } from '../owners/AutoAccept';
import { showToast } from '../customers/shop';
import { apiError } from '../../api/owners/shopApi';
import { fetchDuty, saveDuty, addDayOff, removeDayOff, askLeave, cancelLeave } from '../../api/staff/staffApi';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { onNotification } from '../../api/common/socket';
import OffDutySheet from '../common/OffDutySheet';
import { tr } from '../../i18n';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
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

const STATUS_LINE = {
    on: ['You are on duty. You get every alert.', 'ok'],
    off: ['You are off duty. No alerts until you go live.', 'warn'],
    outside: ['Outside your hours. No alerts until your time starts.', 'warn'],
    holiday: ['Today is your day off. No alerts today.', 'warn'],
    shop_closed: ['The shop is closed. No alerts and no going live until it opens.', 'warn'],
};

export default function DutyCard() {
    const { text, muted, border, primary, ok, warn, error } = useBrand();
    const colors = { ok, warn };
    const [d, setD] = useState(null);
    const [weekly, setWeekly] = useState(null);
    const [mode, setMode] = useState('manual');
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [offOpen, setOffOpen] = useState(false);
    const [askOff, setAskOff] = useState(false);   // "for how long?" when going off duty
    const [leaveOpen, setLeaveOpen] = useState(false);

    const take = useCallback((r, keepEdits) => {
        setD(r);
        if (!keepEdits) { setWeekly(r.weekly); setMode(r.mode); setDirty(false); }
        useStaffStore.getState().patchMe({ onDuty: r.onDuty, dutyStatus: r.status });
    }, []);
    useEffect(() => { fetchDuty().then((r) => take(r, false)).catch(() => { }); }, [take]);
    // the owner answered a leave or took it away: read it again (what the person is typing is kept)
    useEffect(() => onNotification((n) => {
        if (['staff_leave_decision', 'staff_leave_removed', 'staff_holiday'].includes(String(n?.type))) fetchDuty().then((r) => take(r, true)).catch(() => { });
    }), [take]);

    const act = async (fn, msg, keep = true) => { try { take(await fn(), keep); if (msg) showToast(msg); } catch (e) { showToast(apiError(e)); } };
    const setDay = (k, patch) => { setWeekly((w) => ({ ...w, [k]: { ...w[k], ...patch } })); setDirty(true); };
    const save = async () => {
        setSaving(true);
        try { take(await saveDuty({ mode, weekly }), false); showToast(mode === 'auto' ? tr('Saved. You are on duty at your hours') : tr('Saved. You start and end duty by hand')); } catch (e) { showToast(apiError(e)); } finally { setSaving(false); }
    };
    if (!d || !weekly) return null;
    const [line, tone] = STATUS_LINE[d.status] || STATUS_LINE.on;

    return (
        <View>
            <SectionTitle title={tr('Duty')} />
            <Card>
                {d.mode === 'manual' ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{d.status === 'shop_closed' ? tr('Shop is closed') : d.online ? tr('Live') : tr('Off duty')}</Text>
                            <Text style={{ color: colors[tone] || muted, fontSize: 12.5, marginTop: 2 }}>{tr(line)}</Text>
                        </View>
                        <SlideSwitch disabled={d.status === 'shop_closed'} value={d.online && d.status !== 'shop_closed'} onValueChange={(v) => (v ? act(() => saveDuty({ online: true }), tr('You are live')) : setAskOff(true))} accessibilityLabel={tr('Live or off duty')} />
                    </View>
                ) : (
                    <View>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 17 }}>{d.status === 'on' ? tr('On duty now') : tr('Not on duty now')}</Text>
                        <Text style={{ color: colors[tone] || muted, fontSize: 12.5, marginTop: 2 }}>{tr(line)}</Text>
                    </View>
                )}
                <View style={{ marginTop: 14 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr('My hours')}</Text>
                    <Chips options={[['manual', tr('By hand')], ['auto', tr('By the clock')]]} value={mode} onChange={(v) => { setMode(v); setDirty(true); }} style={{ marginTop: 6 }} />
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 4 }}>
                        {mode === 'auto' ? tr('You get alerts only in the hours you set. Days off are skipped.') : tr('You get alerts while the Live switch is on.')}
                    </Text>
                </View>
                {mode === 'auto' ? (
                    <View style={{ marginTop: 6 }}>
                        {DAYS.map(([k, name]) => {
                            const day = weekly[k];
                            return (
                                <View key={k} style={{ paddingVertical: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7), marginTop: 6 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <Text style={{ flex: 1, color: day.on ? text : muted, fontWeight: '800', fontSize: 15 }}>{tr(name)}</Text>
                                        <Text style={{ color: muted, fontSize: 12, marginRight: 8 }}>{day.on ? tr('Working') : tr('Day off')}</Text>
                                        <SlideSwitch value={day.on} onValueChange={(v) => setDay(k, { on: v })} />
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
                {dirty ? <Button label={tr('Save my hours')} icon="checkmark" busy={saving} onPress={save} style={{ marginTop: 14 }} /> : null}
            </Card>

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
            <DaysOffSheet leave visible={leaveOpen} onClose={() => setLeaveOpen(false)} onSubmit={async ({ from, to, note }) => { take(await askLeave({ from, to, reason: note }), true); showToast(tr('Request sent to the owner')); }} />
            <OffDutySheet visible={askOff} onClose={() => setAskOff(false)} onPick={(extra) => act(() => saveDuty({ online: false, ...extra }), tr('You are off duty'))} />
            <DaysOffSheet visible={offOpen} onClose={() => setOffOpen(false)} onSubmit={async (b) => { take(await addDayOff(b), true); showToast(tr('Saved. The owner is told.')); }} />
        </View>
    );
}
