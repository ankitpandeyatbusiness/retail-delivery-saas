// Shared tables: somebody else is already at this table. The guest chooses: a bill of his own, or "I'm with them" (the person there says yes or no, and no
// answer in 2 minutes offers him his own bill). Nobody is ever stuck: every state has a way forward.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, TextInput, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Sheet, Button } from '../owners/ui';
import { fetchTableState, enterTable, fetchJoin, joinPin } from '../../api/customers/shopApi';
import { showToast } from './shop';
import { tr } from '../../i18n';

export default function ChoosePartySheet({ visible, table, onClose, onChosen }) {
    const { text, muted, border, surface, primary, ok, error } = useBrand();
    const [st, setSt] = useState(null);       // the table, as the server sees it
    const [busy, setBusy] = useState('');
    const [wait, setWait] = useState(null);   // { joinId, who, until }: he asked to join and is waiting
    const [outcome, setOutcome] = useState(''); // '' | denied | expired
    const [left, setLeft] = useState(0);
    const [pinJoin, setPinJoin] = useState(null);   // { joinId }: they said yes, he types the PIN that is on their screen
    const [pin, setPin] = useState('');
    const [pinErr, setPinErr] = useState('');
    const timer = useRef(null);

    const load = useCallback(() => fetchTableState(table).then((r) => {
        setSt(r);
        if (r.mine) onChosen?.(r.mine);   // he already has a bill here: nothing to choose
        else if (r.pending?.needsPin) setPinJoin({ joinId: r.pending.joinId });   // he had been told yes and the app was closed: the PIN box comes back
        else if (r.pending) setWait((w) => w || { joinId: r.pending.joinId, until: new Date(r.pending.expiresAt).getTime(), who: null });
    }).catch(() => { }), [table]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (visible && table) { setSt(null); setWait(null); setPinJoin(null); setPin(''); setPinErr(''); setOutcome(''); load(); } }, [visible, table]);   // eslint-disable-line react-hooks/exhaustive-deps

    // while he waits: look at the answer every 3 seconds, and count the time down
    useEffect(() => {
        clearInterval(timer.current);
        if (!wait) return undefined;
        const tick = () => setLeft(Math.max(0, Math.round((wait.until - Date.now()) / 1000)));
        tick();
        timer.current = setInterval(async () => {
            tick();
            try {
                const r = await fetchJoin(wait.joinId);
                if (r.status === 'approved' && r.needsPin) { clearInterval(timer.current); setWait(null); setPin(''); setPinErr(''); setPinJoin({ joinId: wait.joinId }); }   // they said yes: now the PIN
                else if (r.status === 'joined' && r.session) { clearInterval(timer.current); setWait(null); showToast(tr('You are on the table')); onChosen?.(r.session); }
                else if (r.status === 'denied' || r.status === 'expired') { clearInterval(timer.current); setWait(null); setOutcome(r.status); load(); }
            } catch (e) { /* try again in 3 seconds */ }
        }, 3000);
        return () => clearInterval(timer.current);
    }, [wait]);   // eslint-disable-line react-hooks/exhaustive-deps

    const separate = async () => {
        setBusy('separate');
        try { const r = await enterTable(table, 'separate'); onChosen?.(r.session); } catch (e) { showToast(e?.response?.data?.error || tr('Could not do that. Try again.')); load(); } finally { setBusy(''); }
    };
    const withThem = async (p) => {
        setBusy(p.sessionId);
        try {
            const r = await enterTable(table, 'with', p.sessionId);
            if (r.session) onChosen?.(r.session);
            else if (r.pending) { setOutcome(''); setWait({ joinId: r.pending.joinId, until: new Date(r.pending.expiresAt).getTime(), who: p.who }); }
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not do that. Try again.')); load(); } finally { setBusy(''); }
    };

    const submitPin = async () => {
        if (pin.length < 4 || busy) return;
        setBusy('pin'); setPinErr('');
        try { const r = await joinPin(pinJoin.joinId, pin); setPinJoin(null); showToast(tr('You are on the table')); onChosen?.(r.session); }
        catch (e) {
            const code = e?.response?.data?.code;
            setPinErr(e?.response?.data?.error || tr('Could not check the PIN. Try again.'));
            setPin('');
            if (code === 'pin_expired' || code === 'pin_locked' || code === 'gone') { setPinJoin(null); setOutcome('expired'); load(); }
        } finally { setBusy(''); }
    };
    const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Table {n} is shared', { n: table })}>
            {!st ? <View style={{ padding: 30 }}><ActivityIndicator /></View> : null}
            {st && pinJoin ? (
                <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <Ionicons name="checkmark-circle" size={44} color={ok} />
                    <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 10, textAlign: 'center' }}>{tr('They said yes')}</Text>
                    <Text style={{ color: muted, marginTop: 6, textAlign: 'center' }}>{tr('Ask them for the 4-digit PIN on their screen and type it here.')}</Text>
                    <TextInput
                        value={pin} onChangeText={(v) => setPin(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} autoFocus placeholder="••••" placeholderTextColor={muted}
                        style={{ alignSelf: 'stretch', marginTop: 14, borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 14, fontSize: 32, fontWeight: '900', letterSpacing: 10, textAlign: 'center', paddingVertical: 12 }}
                    />
                    {pinErr ? <Text style={{ color: error, fontWeight: '700', marginTop: 8, textAlign: 'center' }}>{pinErr}</Text> : null}
                    <Button label={tr('Join their bill')} icon="checkmark" busy={busy === 'pin'} disabled={pin.length < 4 || !!busy} onPress={submitPin} style={{ alignSelf: 'stretch', marginTop: 14 }} />
                    {st.canSeparate ? <Button label={tr('Take my own bill instead')} kind="ghost" busy={busy === 'separate'} onPress={separate} style={{ alignSelf: 'stretch', marginTop: 8 }} /> : null}
                </View>
            ) : null}
            {st && wait && !pinJoin ? (
                <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <ActivityIndicator color={primary} />
                    <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 14, textAlign: 'center' }}>{wait.who ? tr('Waiting for {name} to say yes', { name: wait.who }) : tr('Waiting for them to say yes')}</Text>
                    <Text style={{ color: muted, marginTop: 6, textAlign: 'center' }}>{tr('If they do not answer in {t}, you can take your own bill.', { t: mm })}</Text>
                    {st.canSeparate ? <Button label={tr('Take my own bill instead')} kind="ghost" busy={busy === 'separate'} onPress={separate} style={{ alignSelf: 'stretch', marginTop: 16 }} /> : null}
                </View>
            ) : null}
            {st && !wait && !pinJoin ? (
                <View>
                    {outcome ? (
                        <View style={{ padding: 12, borderRadius: 14, backgroundColor: alpha(error, 0.1), marginBottom: 12 }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{outcome === 'denied' ? tr('They said no.') : tr('No answer.')} {tr('You can take your own bill.')}</Text>
                        </View>
                    ) : null}
                    <Text style={{ color: muted, marginBottom: 12 }}>{tr('Someone is already sitting here. Are you with them, or do you want your own bill?')}</Text>
                    {st.parties.map((p) => (
                        <View key={p.sessionId} style={{ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface, marginBottom: 10 }}>
                            <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                                <Text style={{ color: primary, fontWeight: '900', fontSize: 18 }}>{p.label}</Text>
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '800' }}>{p.who || tr('A guest')}</Text>
                                <Text style={{ color: muted, fontSize: 12.5 }}>{p.guests === 1 ? tr('1 guest') : tr('{n} guests', { n: p.guests })}</Text>
                            </View>
                            <Pressable onPress={() => withThem(p)} disabled={!!busy} style={{ alignSelf: 'center', flexShrink: 0, marginLeft: 8, paddingHorizontal: 14, height: 40, borderRadius: 20, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', opacity: busy && busy !== p.sessionId ? 0.45 : 1 }}>
                                {busy === p.sessionId ? <ActivityIndicator size="small" color={primary} /> : <Text numberOfLines={1} style={{ color: text, fontWeight: '800', fontSize: 14 }}>{tr("I'm with them")}</Text>}
                            </Pressable>
                        </View>
                    ))}
                    {st.canSeparate ? (
                        <Button label={tr('Separate bill')} icon="receipt-outline" busy={busy === 'separate'} disabled={!!busy} onPress={separate} style={{ marginTop: 4 }} />
                    ) : (
                        <View style={{ padding: 12, borderRadius: 14, backgroundColor: alpha(error, 0.1) }}>
                            <Text style={{ color: text, fontWeight: '700' }}>{tr('This table already has {n} bills. Please ask the waiter.', { n: st.max })}</Text>
                        </View>
                    )}
                    <Text style={{ color: muted, fontSize: 12, textAlign: 'center', marginTop: 10 }}>{tr('A separate bill means you pay only for what you order.')}</Text>
                </View>
            ) : null}
        </Sheet>
    );
}
