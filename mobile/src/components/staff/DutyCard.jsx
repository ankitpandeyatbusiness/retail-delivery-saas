// A cook's or a waiter's own working time, on the Profile page: Go live, and hours (by hand or by the clock). Days off and leave are on their own page.
// Alerts (the ting-tong and the push) reach only people on duty. Nothing here hides the orders: an off-duty person can still open the app.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import SlideSwitch from '../common/SlideSwitch';
import { useBrand, alpha } from '../common/kit';
import { Card, SectionTitle, Button, Chips } from '../owners/ui';
import { TimeStep } from '../owners/AutoAccept';
import { showToast } from '../customers/shop';
import { apiError } from '../../api/owners/shopApi';
import { fetchDuty, saveDuty } from '../../api/staff/staffApi';
import { useStaffStore } from '../../store/staff/useStaffStore';
import { onNotification } from '../../api/common/socket';
import OffDutySheet from '../common/OffDutySheet';
import { tr } from '../../i18n';

const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

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
    const [askOff, setAskOff] = useState(false);   // "for how long?" when going off duty

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
                {/* by hand: the Live switch is in the header at the top, so it is not repeated here */}
                {d.mode === 'manual' ? null : (
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

            <OffDutySheet visible={askOff} onClose={() => setAskOff(false)} onPick={(extra) => act(() => saveDuty({ online: false, ...extra }), tr('You are off duty'))} />
        </View>
    );
}
