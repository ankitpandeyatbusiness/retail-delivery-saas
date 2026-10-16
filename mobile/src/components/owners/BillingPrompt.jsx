// The "Pay now / Remind me later" warning for an unpaid monthly bill (while the grace days run, or once the shop is paused) and
// for a low or finished SMS balance. The server decides what to show and when (services/billingPromptService.js): a postponed
// warning comes back after 6 hours, and a warning that cannot be postponed stays until it is paid.
// Checked a moment after the panel opens and every time the app comes back to the front.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, AppState } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { Sheet, Button } from './ui';
import { fetchBillingPrompts, answerBillingPrompt } from '../../api/owners/shopApi';

export default function BillingPrompt() {
    const nav = useNavigation();
    const { text, muted, error } = useBrand();
    const [item, setItem] = useState(null);
    const [hidden, setHidden] = useState(false);   // closed without answering: not shown again until the app returns to the front
    const busy = useRef(false);

    const check = useCallback(async () => {
        if (busy.current) return;
        busy.current = true;
        try {
            const r = await fetchBillingPrompts();
            const first = (r.items || []).find((i) => i.show) || null;
            setItem(first);
            setHidden(false);
        } catch (e) { /* the panel works without it */ } finally { busy.current = false; }
    }, []);

    useEffect(() => {
        const t = setTimeout(check, 2500);
        const sub = AppState.addEventListener('change', (st) => { if (st === 'active') check(); });
        return () => { clearTimeout(t); sub.remove(); };
    }, [check]);

    if (!item) return null;
    const answer = async (choice) => {
        const kind = item.kind;
        setItem(null);
        answerBillingPrompt(kind, choice).catch(() => { });
        if (choice === 'pay_now') nav.navigate(kind === 'bill' ? 'OwnerRent' : 'OwnerSms');
    };
    const blocked = item.severity === 'blocked';
    return (
        <Sheet visible={!hidden} onClose={() => setHidden(true)} title={item.title}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 }}>
                <Ionicons name={blocked ? 'lock-closed' : 'alert-circle'} size={30} color={error} />
                <Text style={{ color: text, flex: 1, marginLeft: 12, lineHeight: 21 }}>{item.message}</Text>
            </View>
            {item.kind === 'bill' && !blocked ? <Text style={{ color: muted, fontSize: 12, marginBottom: 12 }}>Grace days: you can keep taking orders until the last day, then new orders stop until the bill is paid.</Text> : null}
            <Button label={item.kind === 'bill' ? 'Pay the bill' : 'Top up SMS balance'} icon="card" onPress={() => answer('pay_now')} />
            {item.canSnooze ? <View style={{ marginTop: 8 }}><Button label="Remind me later" kind="ghost" onPress={() => answer('remind_later')} /></View> : null}
        </Sheet>
    );
}
