// Shared tables: somebody else is already at this table. The guest chooses: a bill of his own, or "I'm with them" (the person there says yes or no, and no
// answer in 2 minutes offers him his own bill). Nobody is ever stuck: every state has a way forward.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Sheet, Button } from '../owners/ui';
import { fetchTableState, enterTable, fetchJoin } from '../../api/customers/shopApi';
import { showToast } from './shop';
import { tr } from '../../i18n';

export default function ChoosePartySheet({ visible, table, onClose, onChosen }) {
    const { text, muted, border, surface, primary, ok, error } = useBrand();
    const [st, setSt] = useState(null);       // the table, as the server sees it
    const [busy, setBusy] = useState('');
    const [wait, setWait] = useState(null);   // { joinId, who, until }: he asked to join and is waiting
    const [outcome, setOutcome] = useState(''); // '' | denied | expired
    const [left, setLeft] = useState(0);
    const timer = useRef(null);

    const load = useCallback(() => fetchTableState(table).then((r) => {
        setSt(r);
        if (r.mine) onChosen?.(r.mine);   // he already has a bill here: nothing to choose
        else if (r.pending) setWait((w) => w || { joinId: r.pending.joinId, until: new Date(r.pending.expiresAt).getTime(), who: null });
    }).catch(() => { }), [table]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => { if (visible && table) { setSt(null); setWait(null); setOutcome(''); load(); } }, [visible, table]);   // eslint-disable-line react-hooks/exhaustive-deps

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
                if (r.status === 'approved') { clearInterval(timer.current); setWait(null); showToast(tr('You are on the table')); onChosen?.(r.session); }
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

    const mm = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Table {n} is shared', { n: table })}>
            {!st ? <View style={{ padding: 30 }}><ActivityIndicator /></View> : null}
            {st && wait ? (
                <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <ActivityIndicator color={primary} />
                    <Text style={{ color: text, fontWeight: '900', fontSize: 17, marginTop: 14, textAlign: 'center' }}>{wait.who ? tr('Waiting for {name} to say yes', { name: wait.who }) : tr('Waiting for them to say yes')}</Text>
                    <Text style={{ color: muted, marginTop: 6, textAlign: 'center' }}>{tr('If they do not answer in {t}, you can take your own bill.', { t: mm })}</Text>
                    {st.canSeparate ? <Button label={tr('Take my own bill instead')} kind="ghost" busy={busy === 'separate'} onPress={separate} style={{ alignSelf: 'stretch', marginTop: 16 }} /> : null}
                </View>
            ) : null}
            {st && !wait ? (
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
                            <Button label={tr("I'm with them")} kind="ghost" busy={busy === p.sessionId} disabled={!!busy} onPress={() => withThem(p)} style={{ minWidth: 118 }} />
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
