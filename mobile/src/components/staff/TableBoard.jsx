// The waiter's Tables tab: the whole floor on one screen. A summary on top (how many tables are free, eating, asking for the bill, or need the waiter),
// quick filters, and a card for every table in use with what matters: who is sitting, for how long, the round, how long a dish has waited or been ready,
// what the table is calling for, the amount, and a coloured edge that says how urgent it is. The most urgent table is first. Free tables are small
// chips at the bottom. Timers move by themselves.
import React, { useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { money } from '../owners/ui';
import { useMinuteClock, minsSince, minWord, useColumns } from './staffBits';
import { tr } from '../../i18n';

// how urgent a table is: 3 needs the waiter now, 2 should be looked at, 1 eating quietly, 0 free
function urgency(t, lateMin) {
    if (t.state === 'free') return 0;
    const readyMin = t.readySince ? minsSince(t.readySince) : 0;
    const callMin = t.requestSince ? minsSince(t.requestSince) : 0;
    const waitMin = t.waitingSince ? minsSince(t.waitingSince) : 0;
    if (t.state === 'bill_asked' || t.requests > 0 || readyMin >= lateMin || callMin >= lateMin) return 3;
    if (t.ready > 0 || t.check || waitMin >= lateMin * 3) return 2;
    return 1;
}

function Stat({ icon, color, n, label }) {
    const { text, muted, surface, border } = useBrand();
    return (
        <View style={{ flex: 1, minWidth: 0, marginRight: 8, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 16, backgroundColor: surface, borderWidth: 1, borderColor: n > 0 && color !== muted ? alpha(color, 0.45) : border }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name={icon} size={15} color={color} />
                <Text style={{ color: n > 0 ? color : muted, fontWeight: '900', fontSize: 20, marginLeft: 6 }}>{n}</Text>
            </View>
            <Text numberOfLines={1} style={{ color: muted, fontWeight: '700', fontSize: 11.5, marginTop: 2 }}>{label}</Text>
        </View>
    );
}

function Chip({ on, label, n, onPress }) {
    const { primary, onPrimary, border, muted, surface } = useBrand();
    return (
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, minHeight: 36, borderRadius: 18, marginRight: 8, backgroundColor: on ? primary : surface, borderWidth: 1, borderColor: on ? primary : border }}>
            <Text style={{ color: on ? onPrimary : muted, fontWeight: '800', fontSize: 13 }}>{label}</Text>
            {n > 0 ? <Text style={{ color: on ? onPrimary : primary, fontWeight: '900', fontSize: 12.5, marginLeft: 6 }}>{n}</Text> : null}
        </Pressable>
    );
}

// one small line with an icon: "Seated 38 min", "Dish ready 4 min", "Calling: Water 2 min"
function Line({ icon, color, text, bold }) {
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
            <Ionicons name={icon} size={14} color={color} style={{ marginRight: 6 }} />
            <Text numberOfLines={1} style={{ color, fontWeight: bold ? '900' : '700', fontSize: 12.5, flexShrink: 1 }}>{text}</Text>
        </View>
    );
}

// a table with several bills (shared tables): the table on top, then one line per bill with the first name, its state, the money and the wait
function PartyRow({ p, lateMin, onPress }) {
    const { text, muted, primary, ok, warn, error, border } = useBrand();
    const bill = p.state === 'bill_asked';
    const waitMin = p.waitingSince ? minsSince(p.waitingSince) : null;
    const c = bill ? warn : waitMin != null && waitMin >= lateMin * 3 ? warn : primary;
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: alpha(border, 0.8), opacity: pressed ? 0.7 : 1 })}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: alpha(c, 0.16), alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
                <Text style={{ color: c, fontWeight: '900' }}>{p.label}</Text>
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: text, fontWeight: '800', fontSize: 14 }}>{p.who || tr('Guest')}{p.guests > 1 ? ` +${p.guests - 1}` : ''}</Text>
                <Text numberOfLines={1} style={{ color: bill ? warn : muted, fontWeight: '700', fontSize: 12 }}>
                    {bill ? tr('Wants the bill') : p.since ? tr('Seated {t}', { t: minWord(minsSince(p.since)) }) : tr('Eating')}{waitMin != null && !bill ? ` · ${tr('waited {t}', { t: minWord(waitMin) })}` : ''}
                </Text>
            </View>
            <Text style={{ color: p.due > 0 ? text : ok, fontWeight: '900', fontSize: 14 }}>{p.due > 0 ? money(p.due) : tr('Paid') + ' ✓'}</Text>
        </Pressable>
    );
}

function TableCard({ t, lateMin, level, onPress, width, onOpen }) {
    const { surface, border, text, muted, primary, ok, warn, error } = useBrand();
    const edge = level === 3 ? error : level === 2 ? warn : primary;
    const bill = t.state === 'bill_asked';
    const seated = t.since ? minsSince(t.since) : null;
    const readyMin = t.readySince ? minsSince(t.readySince) : null;
    const callMin = t.requestSince ? minsSince(t.requestSince) : null;
    const waitMin = t.waitingSince ? minsSince(t.waitingSince) : null;
    const hurryMin = t.nudgedAt ? minsSince(t.nudgedAt) : null;
    const many = (t.parties || []).length > 1;
    const status = many ? [tr('{n} bills', { n: t.parties.length }), 'people', primary] : bill ? [tr('Wants the bill'), 'receipt', warn] : t.requests > 0 ? [tr('Calling'), 'hand-left', error] : t.ready > 0 ? [tr('Food is ready'), 'checkmark-done', ok] : t.check ? [tr('Check on the table'), 'eye', warn] : t.cooking > 0 ? [tr('Waiting for food'), 'flame', primary] : [tr('Eating'), 'restaurant', primary];
    return (
        <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ width, marginBottom: 10, padding: 12, borderRadius: 18, backgroundColor: surface, borderWidth: level === 3 ? 1.5 : 1, borderColor: level >= 2 ? alpha(edge, 0.55) : border, borderLeftWidth: 5, borderLeftColor: edge, opacity: pressed ? 0.85 : 1 })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ color: text, fontSize: 26, fontWeight: '900' }}>{t.table}</Text>
                <View style={{ flex: 1 }} />
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 99, backgroundColor: alpha(status[2], 0.14), maxWidth: '75%' }}>
                    <Ionicons name={status[1]} size={12} color={status[2]} style={{ marginRight: 4 }} />
                    <Text numberOfLines={1} style={{ color: status[2], fontWeight: '900', fontSize: 11.5, flexShrink: 1 }}>{status[0]}</Text>
                </View>
            </View>
            {!many && t.who ? <Text numberOfLines={1} style={{ color: muted, fontWeight: '700', marginTop: 2 }}>{t.who}</Text> : null}

            {(t.watch || []).length ? <Line icon="eye" color={warn} bold text={t.watch.map((x) => `${x.name || tr('Guest')}: ${x.state === 'location_off' ? tr('location off') : tr('not reachable')}`).join(' · ')} /> : null}
            {many ? (
                <View style={{ marginTop: 6 }}>
                    {t.parties.map((p) => <PartyRow key={p.sessionId} p={p} lateMin={lateMin} onPress={() => onOpen(t.table, p.sessionId)} />)}
                </View>
            ) : null}
            {!many && seated != null ? <Line icon="time-outline" color={muted} text={tr('Seated {t}', { t: minWord(seated) })} /> : null}
            {t.requests > 0 ? <Line icon="hand-left" color={error} bold text={`${t.requestWhat ? tr(t.requestWhat) : tr('Calling')}${callMin != null ? ` · ${minWord(callMin)}` : ''}`} /> : null}
            {t.ready > 0 ? <Line icon="checkmark-done" color={readyMin >= lateMin ? error : ok} bold text={tr(t.ready === 1 ? '1 dish ready · {t}' : '{n} dishes ready · {t}', { n: t.ready, t: minWord(readyMin || 0) })} /> : null}
            {t.cooking > 0 ? <Line icon="flame" color={waitMin >= lateMin * 3 ? warn : muted} text={tr(t.cooking === 1 ? '1 order cooking' : '{n} orders cooking', { n: t.cooking }) + (waitMin != null ? ` · ${tr('waited {t}', { t: minWord(waitMin) })}` : '')} /> : null}
            {hurryMin != null && hurryMin < 30 && t.cooking > 0 ? <Line icon="alarm-outline" color={warn} text={tr('Asked to hurry {t} ago', { t: minWord(hurryMin) })} /> : null}

            {!many ? <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: alpha(border, 0.8) }}>
                <Text style={{ color: muted, fontWeight: '700', fontSize: 12, flex: 1 }}>{t.rounds === 1 ? tr('1 round') : tr('{n} rounds', { n: t.rounds })}</Text>
                <Text style={{ color: t.due > 0 ? text : ok, fontWeight: '900', fontSize: 15 }}>{t.due > 0 ? money(t.due) : tr('Paid') + ' ✓'}</Text>
            </View> : <Text style={{ color: muted, fontWeight: '700', fontSize: 12, marginTop: 6 }}>{tr('Total')} {money(t.total)} · {tr('To pay')} {money(t.due)}</Text>}
        </Pressable>
    );
}

// a table with several bills needs more room: a full row on a phone
const many2 = (t, per) => ((t.parties || []).length > 1 && per <= 2 ? '100%' : null);

export default function TableBoard({ tables, rules, onOpen }) {
    const { text, muted, ok, warn, error, primary } = useBrand();
    useMinuteClock();
    const cols = useColumns();
    const [filter, setFilter] = useState('all');
    const lateMin = rules?.serveLateMin || 3;
    const per = cols === 1 ? 2 : cols === 2 ? 3 : 4;
    const gap = 10;
    const width = `${(100 - ((per - 1) * 2.4)) / per}%`;

    const rows = useMemo(() => tables.map((t) => ({ ...t, level: urgency(t, lateMin) })), [tables, lateMin]);   // eslint-disable-line react-hooks/exhaustive-deps
    const used = rows.filter((t) => t.state !== 'free');
    const free = rows.filter((t) => t.state === 'free');
    const need = used.filter((t) => t.level >= 2);
    const eating = used.filter((t) => t.state === 'eating');
    const bills = used.filter((t) => t.state === 'bill_asked');
    const due = used.reduce((m, t) => m + (t.due || 0), 0);
    const shown = (filter === 'need' ? need : filter === 'eating' ? eating : filter === 'bill' ? bills : used)
        .slice().sort((a, b) => b.level - a.level || (new Date(a.waitingSince || a.since || 0) - new Date(b.waitingSince || b.since || 0)));

    if (!rows.length) return null;
    return (
        <View>
            <View style={{ flexDirection: 'row', marginBottom: 10, marginRight: -8 }}>
                <Stat icon="alert-circle" color={need.length ? error : muted} n={need.length} label={tr('Need you')} />
                <Stat icon="restaurant" color={primary} n={eating.length} label={tr('Eating')} />
                <Stat icon="receipt" color={bills.length ? warn : muted} n={bills.length} label={tr('Bill')} />
                <Stat icon="grid-outline" color={ok} n={free.length} label={tr('Free')} />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 12 }}>
                <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, flex: 1 }}>{used.length ? tr('{n} of {m} tables in use', { n: used.length, m: rows.length }) : tr('All tables are free')}</Text>
                {due > 0 ? <Text style={{ color: text, fontWeight: '900', fontSize: 13 }}>{tr('To collect')} {money(due)}</Text> : null}
            </View>
            {used.length ? (
                <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                    <Chip on={filter === 'all'} label={tr('All')} n={used.length} onPress={() => setFilter('all')} />
                    <Chip on={filter === 'need'} label={tr('Need you')} n={need.length} onPress={() => setFilter('need')} />
                    <Chip on={filter === 'eating'} label={tr('Eating')} n={eating.length} onPress={() => setFilter('eating')} />
                    <Chip on={filter === 'bill'} label={tr('Bill')} n={bills.length} onPress={() => setFilter('bill')} />
                </View>
            ) : null}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                {shown.map((t) => <TableCard key={t.table} t={t} lateMin={lateMin} level={t.level} width={many2(t, per) || width} onOpen={onOpen} onPress={() => onOpen(t.table, t.sessionId)} />)}
                {Array.from({ length: (per - (shown.length % per)) % per }).map((_, i) => <View key={`pad${i}`} style={{ width }} />)}
            </View>
            {used.length && !shown.length ? <Text style={{ color: muted, textAlign: 'center', marginVertical: 16 }}>{tr('No tables here right now.')}</Text> : null}
            {free.length ? (
                <View style={{ marginTop: 8 }}>
                    <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 8 }}>{tr('FREE TABLES')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                        {free.map((t) => (
                            <View key={t.table} style={{ minWidth: 42, height: 42, paddingHorizontal: 10, borderRadius: 21, marginRight: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderColor: alpha(ok, 0.6), backgroundColor: alpha(ok, 0.08) }}>
                                <Text style={{ color: ok, fontWeight: '900', fontSize: 15 }}>{t.table}</Text>
                            </View>
                        ))}
                    </View>
                </View>
            ) : null}
        </View>
    );
}
