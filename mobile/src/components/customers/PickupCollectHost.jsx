// At his pickup time the app asks: did you collect it? Yes (the shop confirms, and if it was cash, whether he paid) | I do not want it
// (the shop decides the refund) | Not yet (asked again in 15 minutes). It comes up whenever the app opens and while he is in the app.
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { useBrand } from '../common/kit';
import { Button, Sheet } from '../owners/ui';
import { useAuthStore } from '../../store/common/useAuthStore';
import { fetchPickupDue, answerPickup } from '../../api/customers/shopApi';
import { onNotification } from '../../api/common/socket';
import { showToast } from './shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

export default function PickupCollectHost() {
    const { text, muted } = useBrand();
    const user = useAuthStore((s) => s.user);
    const on = !!user && user.role === 'customer';
    const [items, setItems] = useState([]);
    const [hidden, setHidden] = useState([]);   // closed for now on this phone (the server asks again later)
    const [busy, setBusy] = useState('');
    const load = useCallback(() => { fetchPickupDue().then((r) => setItems(r.items || [])).catch(() => { }); }, []);

    useEffect(() => {
        if (!on) { setItems([]); return undefined; }
        load();
        const a = AppState.addEventListener('change', (st) => { if (st === 'active') { setHidden([]); load(); } });
        const b = onNotification((n) => { if (n && /^pickup_|^order_status/.test(String(n.type || ''))) load(); });
        const t = setInterval(load, 60000);
        return () => { a.remove(); b(); clearInterval(t); };
    }, [on, load]);

    const cur = on ? items.find((x) => !hidden.includes(x.id)) : null;
    const answer = async (a) => {
        if (cur.mode === 'ready' && ['coming', 'on_time'].includes(a)) {
            const yes = await ask({ title: a === 'coming' ? tr('Tell the shop you are coming?') : tr('Keep it for your time?'), message: a === 'coming' ? tr('The shop will be told right away.') : tr('The shop will keep it for your pickup time.'), confirmText: tr('Yes'), cancelText: tr('Go back') });
            if (!yes) return;
            setBusy(a);
            try {
                await answerPickup(cur.id, a);
                setItems((l) => l.filter((x) => x.id !== cur.id));
                showToast(a === 'coming' ? tr('The shop knows you are coming.') : tr('Okay. The shop will keep it for your time.'));
            } catch (e) { showToast(e?.response?.data?.error || tr('Could not send that. Try again.')); } finally { setBusy(''); }
            return;
        }
        if (a === 'collected') {
            const yes = await ask({ title: tr('Did you get your food?'), message: tr('We will tell the shop you took it.'), confirmText: tr('Yes, I got it'), cancelText: tr('Go back') });
            if (!yes) return;
        }
        if (a === 'not_wanted') {
            const yes = await ask({ title: tr('You do not want the food?'), message: tr('We will tell the shop. They will decide about the refund and let you know.'), confirmText: tr('Yes, I do not want it'), cancelText: tr('Go back') });
            if (!yes) return;
        }
        setBusy(a);
        try {
            await answerPickup(cur.id, a);
            setItems((l) => l.filter((x) => x.id !== cur.id));
            if (a === 'collected') showToast(tr('Thank you! We told the shop.'));
            else if (a === 'not_wanted') showToast(tr('We told the shop. They will get back to you.'));
            else setHidden((h) => [...h, cur.id]);
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send that. Try again.')); } finally { setBusy(''); }
    };

    return (
        <Sheet visible={!!cur} onClose={() => (cur?.mode === 'ready' ? setHidden((h) => [...h, cur.id]) : cur && answer('later'))} title={cur ? (cur.mode === 'ready' ? tr('Order #{n} is ready!', { n: cur.orderNo }) : tr('Order #{n}: did you collect it?', { n: cur.orderNo })) : ''}>
            {cur?.mode === 'ready' ? (
                <View>
                    <Text style={{ color: muted, marginBottom: 8 }}>{cur.early ? tr('It is ready before your pickup time. Are you coming?') : tr('Come and collect it. Are you coming?')}</Text>
                    {cur.items.map((it, i) => <Text key={i} style={{ color: text, paddingVertical: 2, fontWeight: '700' }}>{it.quantity}× {it.name}</Text>)}
                    <Button label={tr('Coming now')} icon="walk" busy={busy === 'coming'} disabled={!!busy} onPress={() => answer('coming')} style={{ marginTop: 14 }} />
                    {cur.early ? <Button label={tr('On my time')} icon="time" kind="ghost" busy={busy === 'on_time'} disabled={!!busy} onPress={() => answer('on_time')} style={{ marginTop: 8 }} /> : null}
                    <Button label={tr("Can't come")} icon="close-circle" kind="ghost" busy={busy === 'not_wanted'} disabled={!!busy} onPress={() => answer('not_wanted')} style={{ marginTop: 8 }} />
                    <Button label={tr('Ignore')} kind="ghost" disabled={!!busy} onPress={() => setHidden((h) => [...h, cur.id])} style={{ marginTop: 8 }} />
                </View>
            ) : cur ? (
                <View>
                    <Text style={{ color: muted, marginBottom: 8 }}>{tr('Your pickup time has come.')}{cur.cash ? ` ${tr('It is a cash order of ₹{n}.', { n: Math.round(cur.total) })}` : ''}</Text>
                    {cur.items.map((it, i) => <Text key={i} style={{ color: text, paddingVertical: 2, fontWeight: '700' }}>{it.quantity}× {it.name}</Text>)}
                    <Button label={tr('Yes, I collected it')} icon="checkmark-circle" busy={busy === 'collected'} disabled={!!busy} onPress={() => answer('collected')} style={{ marginTop: 14 }} />
                    <Button label={tr('Not yet')} icon="time" kind="ghost" busy={busy === 'later'} disabled={!!busy} onPress={() => answer('later')} style={{ marginTop: 8 }} />
                    <Button label={tr('I do not want the food any more')} icon="close-circle" kind="danger" busy={busy === 'not_wanted'} disabled={!!busy} onPress={() => answer('not_wanted')} style={{ marginTop: 8 }} />
                </View>
            ) : null}
        </Sheet>
    );
}
