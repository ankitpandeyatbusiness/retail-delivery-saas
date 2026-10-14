import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, TextField, Switch, Hint } from '../../components/settingsForm';
import { Button, Badge } from '../../components/ui';
import Icon from '../../components/Icon';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { nameOf } from '../../utils/settings';
import { useTheme, spacing, radius, font } from '../../theme';

const DAY_ORDER = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const DEFAULT_SLOT = { open: '09:00', close: '22:00' };
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

// "9" -> "9", "930" -> "09:30" while typing, so the colon never has to be typed
const maskTime = (v) => {
    const d = v.replace(/[^\d]/g, '').slice(0, 4);
    return d.length > 2 ? `${d.slice(0, 2)}:${d.slice(2)}` : d;
};
const maskDate = (v) => {
    const d = v.replace(/[^\d]/g, '').slice(0, 8);
    if (d.length > 6) return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
    if (d.length > 4) return `${d.slice(0, 4)}-${d.slice(4)}`;
    return d;
};

function TimeBox({ value, onChange, label }) {
    const t = useTheme();
    const ok = !value || TIME.test(value);
    return (
        <View style={{ flex: 1 }}>
            <TextField
                label={label}
                value={value}
                onChange={(v) => onChange(maskTime(v))}
                placeholder="HH:MM"
                keyboardType="number-pad"
                maxLength={5}
                last
                autoCapitalize="none"
            />
            {!ok ? <Text style={{ color: t.danger, fontSize: font.xs, marginTop: 2 }}>Use 24-hour time, like 09:30</Text> : null}
        </View>
    );
}

export default function SettingsHoursScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['hours']);
    const h = ed.draft?.hours;
    const weekly = h?.weekly || {};
    const always = ed.ready && Object.keys(weekly).length === 0;

    const setWeekly = (next) => ed.set('hours', 'weekly', next);
    const setDay = (day, slots) => setWeekly({ ...weekly, [day]: slots });
    const setSlot = (day, i, k, v) => setDay(day, (weekly[day] || []).map((s, n) => (n === i ? { ...s, [k]: v } : s)));
    const dates = h?.closedDates || [];
    const setDates = (next) => ed.set('hours', 'closedDates', next);

    const fillAll = (slots) => setWeekly(Object.fromEntries(DAY_ORDER.map((d) => [d, slots.map((s) => ({ ...s }))])));

    return (
        <SettingsPage ed={ed} title="Opening hours" subtitle={name}>
            {ed.ready ? (
                <>
                    {always ? (
                        <Group title="Weekly hours" section="orders">
                            <Badge label="Always open" tone="success" />
                            <Hint>No hours are set, so the shop is open all day, every day, unless the owner pauses orders.</Hint>
                            <View style={{ height: spacing.md }} />
                            <Button title="Set opening hours" icon="clock" kind="soft" onPress={() => fillAll([DEFAULT_SLOT])} />
                        </Group>
                    ) : (
                        <>
                            <Group title="Weekly hours" section="orders" hint="Up to 3 time slots a day. A closing time earlier than the opening time means after midnight.">
                                {DAY_ORDER.map((day, di) => {
                                    const slots = weekly[day] || [];
                                    const open = slots.length > 0;
                                    return (
                                        <View key={day} style={{ paddingVertical: spacing.sm, borderTopWidth: di ? 0.5 : 0, borderTopColor: t.border }}>
                                            <Switch
                                                title={nameOf('day', day)}
                                                subtitle={open ? `${slots.length} slot${slots.length > 1 ? 's' : ''}` : 'Closed'}
                                                value={open}
                                                onValueChange={(v) => setDay(day, v ? [{ ...DEFAULT_SLOT }] : [])}
                                                last
                                            />
                                            {slots.map((s, i) => (
                                                <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: spacing.sm }}>
                                                    <TimeBox label={i === 0 ? 'Opens' : undefined} value={s.open} onChange={(v) => setSlot(day, i, 'open', v)} />
                                                    <View style={{ width: spacing.md }} />
                                                    <TimeBox label={i === 0 ? 'Closes' : undefined} value={s.close} onChange={(v) => setSlot(day, i, 'close', v)} />
                                                    <Pressable onPress={() => setDay(day, slots.filter((_, n) => n !== i))} hitSlop={8} style={{ width: 40, height: 48, alignItems: 'center', justifyContent: 'center' }}>
                                                        <Icon name="trash" size={20} color={t.danger} />
                                                    </Pressable>
                                                </View>
                                            ))}
                                            {open && slots.length < 3 ? (
                                                <Pressable onPress={() => setDay(day, [...slots, { open: '17:00', close: '22:00' }])} style={{ marginTop: spacing.sm }}>
                                                    <Text style={{ color: t.primary, fontWeight: '700' }}>+ Add a slot</Text>
                                                </Pressable>
                                            ) : null}
                                        </View>
                                    );
                                })}
                                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                                    <Button small kind="soft" title="Copy Monday to all" style={{ flex: 1 }} onPress={() => fillAll(weekly.mon?.length ? weekly.mon : [DEFAULT_SLOT])} />
                                    <Button small kind="dangerSoft" title="Always open" style={{ flex: 1 }} onPress={() => setWeekly({})} />
                                </View>
                            </Group>
                        </>
                    )}

                    <Group title="When closed" section="alerts">
                        <TextField label="Message shown to customers" value={h.closedMessage} onChange={(v) => ed.set('hours', 'closedMessage', v)} maxLength={120} placeholder="We are closed right now" last />
                    </Group>

                    <Group title="Holidays" section="alerts" hint="The shop is closed for the whole date range (India time). Up to 30.">
                        {dates.map((r, i) => (
                            <View key={i} style={{ borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border, paddingTop: i ? spacing.md : 0, marginBottom: spacing.md }}>
                                <View style={{ flexDirection: 'row' }}>
                                    <View style={{ flex: 1 }}>
                                        <TextField label="From" value={r.from} placeholder="YYYY-MM-DD" keyboardType="number-pad" maxLength={10} last
                                            onChange={(v) => setDates(dates.map((x, n) => (n === i ? { ...x, from: maskDate(v) } : x)))} />
                                    </View>
                                    <View style={{ width: spacing.md }} />
                                    <View style={{ flex: 1 }}>
                                        <TextField label="To" value={r.to} placeholder="YYYY-MM-DD" keyboardType="number-pad" maxLength={10} last
                                            onChange={(v) => setDates(dates.map((x, n) => (n === i ? { ...x, to: maskDate(v) } : x)))} />
                                    </View>
                                </View>
                                <View style={{ marginTop: spacing.md }}>
                                    <TextField label="Message (optional)" value={r.message || ''} maxLength={120} placeholder="Closed for Diwali" last
                                        onChange={(v) => setDates(dates.map((x, n) => (n === i ? { ...x, message: v } : x)))} />
                                </View>
                                {r.from && r.to && (!YMD.test(r.from) || !YMD.test(r.to) || r.to < r.from) ? (
                                    <Text style={{ color: t.danger, fontSize: font.xs, marginTop: 4 }}>Both dates are needed, and "To" cannot be before "From".</Text>
                                ) : null}
                                <Button title="Remove this holiday" kind="dangerSoft" small style={{ marginTop: spacing.sm }} onPress={() => setDates(dates.filter((_, n) => n !== i))} />
                            </View>
                        ))}
                        {dates.length < 30 ? <Button title="Add a holiday" kind="soft" small icon="add" onPress={() => setDates([...dates, { from: '', to: '' }])} /> : null}
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
