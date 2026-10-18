// One-tap Remind: shows the message the customer will get (push + his in-app inbox), lets the owner change it, and sends.
// The server holds a message back when it would be too much (he ordered today, got enough this week, it is night...); we show why.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useBrand } from '../common/kit';
import { Sheet, Button, Field } from './ui';
import { ToggleRow, Hint, Label } from './menuBits';
import { fetchRemindPreview, sendRemind, apiError } from '../../api/owners/shopApi';
import { showToast } from '../customers/shop';
import { LineShimmer } from './shimmer';
import { tr } from '../../i18n';

export default function RemindSheet({ visible, onClose, customer, onSent }) {
    const { muted, error } = useBrand();
    const [p, setP] = useState(null);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [offer, setOffer] = useState(false);
    const [edited, setEdited] = useState(false);
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');

    const load = (withOffer) => {
        setP(null); setErr('');
        fetchRemindPreview(customer.id, withOffer)
            .then((r) => { setP(r); setTitle(r.title); setBody(r.body); setEdited(false); })
            .catch((e) => setErr(apiError(e, 'Could not make the message.')));
    };
    useEffect(() => { if (visible && customer) { setOffer(false); load(false); } }, [visible, customer?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

    const toggleOffer = (v) => { setOffer(v); load(v); };
    const send = async () => {
        setBusy(true);
        try {
            await sendRemind(customer.id, { ...(edited ? { title: title.trim(), body: body.trim() } : {}), withOffer: offer });
            showToast(tr('Sent'));
            onSent?.(); onClose();
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };
    const first = (customer?.name || 'him').split(' ')[0];

    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Remind {first}', { first: first })}>
            {err ? <Text style={{ color: error, marginVertical: 12 }}>{err}</Text> : null}
            {!p && !err ? <View style={{ paddingVertical: 12 }}><LineShimmer width={220} height={16} /><View style={{ height: 10 }} /><LineShimmer width={280} height={16} /></View> : null}
            {p ? (
                <>
                    <Hint>{tr('He gets this as a notification and in his app inbox. It is not sent by SMS or email. You can change the words.')}</Hint>
                    <View style={{ height: 8 }} />
                    <Label>{tr('Title')}</Label>
                    <Field value={title} onChangeText={(x) => { setTitle(x); setEdited(true); }} maxLength={60} />
                    <View style={{ height: 10 }} />
                    <Label>{tr('Message')}</Label>
                    <Field value={body} onChangeText={(x) => { setBody(x); setEdited(true); }} multiline maxLength={200} style={{ minHeight: 70 }} />
                    {p.maxDiscount > 0 ? (
                        <ToggleRow title={tr('Add a {maxDiscount}% discount code', { maxDiscount: p.maxDiscount })} subtitle={tr('A one-time code, valid for 5 days, only for this message')} value={offer} onValueChange={toggleOffer} last />
                    ) : null}
                    {!p.canSend ? <Text style={{ color: error, fontWeight: '700', marginVertical: 10 }}>{p.holdBack}</Text> : <Text style={{ color: muted, fontSize: 12, marginVertical: 10 }}>{tr('Language: {v1}. Change it in Autopilot.', { v1: p.language === 'hi' ? 'Hindi' : p.language === 'en' ? 'English' : 'Hinglish' })}</Text>}
                    <Button label={tr('Send reminder')} icon="paper-plane" busy={busy} disabled={!p.canSend || !title.trim() || !body.trim()} onPress={send} />
                </>
            ) : null}
        </Sheet>
    );
}
