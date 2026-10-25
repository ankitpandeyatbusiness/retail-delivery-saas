// Shared tables: someone at the same table asks to join this guest's bill. A sheet comes up over whatever he is doing, with Yes (we are together) and No.
// It looks again when a message arrives, when the app opens and every 15 seconds; a request nobody answers runs out by itself after 2 minutes.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useBrand } from '../common/kit';
import { Button, Sheet } from '../owners/ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { fetchJoins, answerJoin } from '../../api/customers/shopApi';
import { Ionicons } from '@expo/vector-icons';
import { onNotification } from '../../api/common/socket';
import { showToast } from './shop';
import { tr } from '../../i18n';

export default function JoinRequestHost() {
    const { text, muted } = useBrand();
    const user = useAuthStore((s) => s.user);
    const on = !!user && user.role === 'customer';
    const [items, setItems] = useState([]);
    const [hidden, setHidden] = useState([]);
    const [busy, setBusy] = useState('');
    const [pinFor, setPinFor] = useState(null);   // { who, pin }: they said yes, this PIN is told to the newcomer
    const load = useCallback(() => { fetchJoins().then((r) => setItems(r.items || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (!on) { setItems([]); return undefined; }
        load();
        const a = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        const b = onNotification((n) => { if (n && n.type === 'table_join_request') { setHidden([]); load(); } });
        const t = setInterval(() => { if (AppState.currentState === 'active') load(); }, 15000);
        return () => { a.remove(); b(); clearInterval(t); };
    }, [on, load]);

    const cur = on ? items.find((x) => !hidden.includes(x.joinId) && !x.pin) : null;
    // one they said yes to, still waiting for the newcomer to type the PIN (the app was closed meanwhile): the PIN is shown again
    const waitingPin = on && !cur && !pinFor ? items.find((x) => x.pin && !hidden.includes(x.joinId)) : null;
    const answer = async (approve, block) => {
        setBusy(block ? 'block' : approve ? 'yes' : 'no');
        try {
            const r = await answerJoin(cur.joinId, approve, block);
            setItems((l) => l.filter((x) => x.joinId !== cur.joinId));
            if (approve && r.pin) setPinFor({ who: cur.who, pin: r.pin });
            else showToast(block ? tr('Blocked. They cannot ask again.') : tr('We told them'));
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send that. Try again.')); load(); } finally { setBusy(''); }
    };
    return (
        <>
        <Sheet visible={!!cur} onClose={() => cur && setHidden((h) => [...h, cur.joinId])} title={cur ? tr('{name} wants to join your table', { name: cur.who || tr('Someone') }) : ''}>
            {cur ? (
                <View>
                    <Text style={{ color: muted, marginBottom: 6 }}>{tr('At table {n}. Are you together? If you say yes, their food goes on your bill.', { n: cur.table })}</Text>
                    <Text style={{ color: text, fontWeight: '700', marginBottom: 6 }}>{tr('If you do not know them, say no. They can take their own bill.')}</Text>
                    <Button label={tr('Yes, we are together')} icon="checkmark-circle" busy={busy === 'yes'} disabled={!!busy} onPress={() => answer(true)} style={{ marginTop: 12 }} />
                    <Button label={tr('No')} icon="close-circle" kind="ghost" busy={busy === 'no'} disabled={!!busy} onPress={() => answer(false)} style={{ marginTop: 8 }} />
                    <Button label={tr('No, and block them')} icon="ban" kind="ghost" busy={busy === 'block'} disabled={!!busy} onPress={() => answer(false, true)} style={{ marginTop: 8 }} />
                </View>
            ) : null}
        </Sheet>
            <Sheet visible={!!pinFor || !!waitingPin} onClose={() => { if (waitingPin) setHidden((h) => [...h, waitingPin.joinId]); setPinFor(null); }} title={tr('Tell them this PIN')}>
                {(pinFor || waitingPin) ? (
                    <View style={{ alignItems: 'center' }}>
                        <Text style={{ color: muted, textAlign: 'center', marginBottom: 10 }}>{tr('{name} types this PIN on their phone to join your bill. Only tell it to someone you know.', { name: (pinFor || waitingPin).who || tr('They') })}</Text>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 44, letterSpacing: 12 }}>{(pinFor || waitingPin).pin}</Text>
                        <Button label={tr('Done')} icon="checkmark" onPress={() => { if (waitingPin) setHidden((h) => [...h, waitingPin.joinId]); setPinFor(null); }} style={{ alignSelf: 'stretch', marginTop: 16 }} />
                    </View>
                ) : null}
            </Sheet>
        </>
    );
}
