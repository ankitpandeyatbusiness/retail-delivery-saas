// Shared tables: someone at the same table asks to join this guest's bill. A sheet comes up over whatever he is doing, with Yes (we are together) and No.
// It looks again when a message arrives, when the app opens and every 15 seconds; a request nobody answers runs out by itself after 2 minutes.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useBrand } from '../common/kit';
import { Button, Sheet } from '../owners/ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { fetchJoins, answerJoin } from '../../api/customers/shopApi';
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
    const load = useCallback(() => { fetchJoins().then((r) => setItems(r.items || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (!on) { setItems([]); return undefined; }
        load();
        const a = AppState.addEventListener('change', (st) => { if (st === 'active') load(); });
        const b = onNotification((n) => { if (n && n.type === 'table_join_request') { setHidden([]); load(); } });
        const t = setInterval(() => { if (AppState.currentState === 'active') load(); }, 15000);
        return () => { a.remove(); b(); clearInterval(t); };
    }, [on, load]);

    const cur = on ? items.find((x) => !hidden.includes(x.joinId)) : null;
    const answer = async (approve) => {
        setBusy(approve ? 'yes' : 'no');
        try {
            await answerJoin(cur.joinId, approve);
            setItems((l) => l.filter((x) => x.joinId !== cur.joinId));
            showToast(approve ? tr('They are on your bill now') : tr('We told them'));
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send that. Try again.')); load(); } finally { setBusy(''); }
    };
    return (
        <Sheet visible={!!cur} onClose={() => cur && setHidden((h) => [...h, cur.joinId])} title={cur ? tr('{name} wants to join your table', { name: cur.who || tr('Someone') }) : ''}>
            {cur ? (
                <View>
                    <Text style={{ color: muted, marginBottom: 6 }}>{tr('At table {n}. Are you together? If you say yes, their food goes on your bill.', { n: cur.table })}</Text>
                    <Text style={{ color: text, fontWeight: '700', marginBottom: 6 }}>{tr('If you do not know them, say no. They can take their own bill.')}</Text>
                    <Button label={tr('Yes, we are together')} icon="checkmark-circle" busy={busy === 'yes'} disabled={!!busy} onPress={() => answer(true)} style={{ marginTop: 12 }} />
                    <Button label={tr('No')} icon="close-circle" kind="ghost" busy={busy === 'no'} disabled={!!busy} onPress={() => answer(false)} style={{ marginTop: 8 }} />
                </View>
            ) : null}
        </Sheet>
    );
}
