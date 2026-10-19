// Auto accept: new orders are accepted by themselves while the owner is busy.
//   <AutoAcceptCard />   a card for the Home screen: what is set now, and one tap to change it
// The choice is saved on the server (services/autoAccept.js) and worked out when an order arrives, so it works with the app closed.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { Card, Sheet, Button, Chips, Pill } from './ui';
import { ToggleRow } from './menuBits';
import { LineShimmer } from './shimmer';
import { fetchAutoAccept, saveAutoAccept, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../customers/shop';
import { tr } from '../../i18n';

const pad = (n) => String(n).padStart(2, '0');
const toMin = (t) => { const [h, m] = String(t).split(':'); return Number(h) * 60 + Number(m); };
const clock = (t) => { const m = toMin(t); const h = Math.floor(m / 60); return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? 'AM' : 'PM'}`; };
const shift = (t, d) => { const m = (toMin(t) + d + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };

// "1:00 PM"  with  -  +  to move it by half an hour
export function TimeStep({ label, value, onChange }) {
    const { text, muted, border, primary } = useBrand();
    return (
        <View style={{ flex: 1 }}>
            <Text style={{ color: muted, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{label}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 14, paddingVertical: 6, paddingHorizontal: 6 }}>
                <Pressable onPress={() => onChange(shift(value, -30))} hitSlop={8} style={{ padding: 6 }}><Ionicons name="remove-circle-outline" size={24} color={primary} /></Pressable>
                <Text style={{ flex: 1, color: text, fontWeight: '900', fontSize: 15, textAlign: 'center' }}>{clock(value)}</Text>
                <Pressable onPress={() => onChange(shift(value, 30))} hitSlop={8} style={{ padding: 6 }}><Ionicons name="add-circle-outline" size={24} color={primary} /></Pressable>
            </View>
        </View>
    );
}

function AutoAcceptSheet({ visible, onClose, current, onSaved }) {
    const { muted } = useBrand();
    const [on, setOn] = useState(false);
    const [timed, setTimed] = useState(false);
    const [from, setFrom] = useState('13:00');
    const [to, setTo] = useState('15:00');
    const [repeat, setRepeat] = useState('today');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setOn(!!current?.on);
        setTimed(!!(current?.from && current?.to));
        setFrom(current?.from || '13:00');
        setTo(current?.to || '15:00');
        setRepeat(current?.repeat || 'today');
    }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps

    const save = async () => {
        setBusy(true);
        try {
            const r = await saveAutoAccept(on ? { on: true, repeat, ...(timed ? { from, to } : {}) } : { on: false });
            onSaved(r);
            showToast(on ? tr('Auto accept is on') : tr('Auto accept is off. You accept orders by hand'));
            onClose();
        } catch (e) {
            useOwnerStore.getState().noteError(e);
            showToast(apiError(e));
        } finally { setBusy(false); }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Accepting orders')}>
            <ToggleRow
                title={tr('Accept new orders by itself')}
                subtitle={on ? tr('Every new order is accepted at once. The Soundbox still tells you about it.') : tr('You accept or reject every order by hand')}
                value={on}
                onValueChange={setOn}
                last
            />
            {on ? (
                <View style={{ marginTop: 6 }}>
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 10 }}>{tr('WHEN')}</Text>
                    <Chips options={[[false, tr('Whole time the shop is open')], [true, tr('Only between two times')]]} value={timed} onChange={setTimed} />
                    {timed ? (
                        <View style={{ flexDirection: 'row', marginTop: 12 }}>
                            <TimeStep label={tr('FROM')} value={from} onChange={setFrom} />
                            <View style={{ width: 12 }} />
                            <TimeStep label={tr('UNTIL')} value={to} onChange={setTo} />
                        </View>
                    ) : null}

                    <Text style={{ color: muted, fontSize: 12, fontWeight: '800', marginTop: 16 }}>{tr('FOR')}</Text>
                    <Chips options={[['today', tr('Today only')], ['daily', tr('Every day')]]} value={repeat} onChange={setRepeat} />
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 10 }}>
                        {repeat === 'today'
                            ? tr('It switches itself off after today. Tomorrow you accept by hand again.')
                            : tr('It works on every day the shop is open. Holidays and closed days bring no orders, so nothing is accepted then.')}
                    </Text>
                </View>
            ) : null}
            <Button label={tr('Save')} icon="checkmark" busy={busy} onPress={save} style={{ marginTop: 18 }} />
        </Sheet>
    );
}

export function AutoAcceptCard() {
    const { primary, text, muted, ok } = useBrand();
    const [cur, setCur] = useState(null);
    const [open, setOpen] = useState(false);

    const load = useCallback(async () => {
        try { setCur(await fetchAutoAccept()); } catch (e) { /* the card stays as it was */ }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const on = !!cur?.on;
    const line = !cur ? null
        : !on ? tr('Off. You accept every order by hand.')
            : `${cur.from && cur.to ? `${clock(cur.from)} - ${clock(cur.to)}` : tr('Whole time the shop is open')} · ${cur.repeat === 'daily' ? tr('every day') : tr('today only')}`;

    return (
        <>
            <Card onPress={() => setOpen(true)} tone={on ? ok : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(on ? ok : primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                        <Ionicons name="flash" size={20} color={on ? ok : primary} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('Auto accept orders')}</Text>
                        {line ? <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }} numberOfLines={2}>{line}</Text> : <LineShimmer width={150} height={12} />}
                    </View>
                    {cur ? (on ? <Pill label={cur.active ? tr('ON') : tr('WAITING')} color={ok} /> : <Pill label={tr('MANUAL')} color={muted} />) : null}
                </View>
            </Card>
            <AutoAcceptSheet visible={open} onClose={() => setOpen(false)} current={cur} onSaved={setCur} />
        </>
    );
}
