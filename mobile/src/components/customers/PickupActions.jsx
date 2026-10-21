// "Collect your food": once a pickup order is ready the customer can tell the shop where he is: I'm coming, I'm here, Got my food, and (when his time has
// passed) On my way sorry, Need more time. Can't come asks first, then the shop decides the refund. The shop is told each time, with a sound.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { answerPickup } from '../../api/customers/shopApi';
import { showToast } from './shop';
import { ask } from '../common/dialog';
import { tr } from '../../i18n';

const COOL_MS = 3 * 60000;   // the same message again only after this long (the server keeps the same rule)
const WORDS = {
    coming: ['Tell the shop you are coming?', 'The shop will be told right away.', 'Yes, tell them'],
    late: ['Tell the shop you are on your way?', 'We will say you are late but coming.', 'Yes, tell them'],
    more_time: ['Ask for a little more time?', 'The shop will keep your food for you.', 'Yes, ask'],
    arrived: ['Tell the shop you are here?', 'They will bring your food and check your code.', 'Yes, I am here'],
    collected: ['Did you get your food?', 'We will tell the shop you took it.', 'Yes, I got it'],
};
const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const SAID = { coming: 'You said: coming', arrived: 'You said: I am here', on_time: 'You said: on my time', late: 'You said: on my way, sorry', more_time: 'You asked for more time' };

export function PickupChip({ icon, label, onPress, busy, strong, danger, wait }) {
    const { primary, onPrimary, text, border, error } = useBrand();
    const ink = strong ? onPrimary : danger ? error : text;
    return (
        <Pressable onPress={onPress} disabled={busy || !!wait} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, minHeight: 44, borderRadius: 22, marginRight: 8, marginBottom: 8, backgroundColor: strong ? primary : 'transparent', borderWidth: 1.5, borderColor: strong ? primary : danger ? alpha(error, 0.5) : border, opacity: busy || wait ? 0.5 : pressed ? 0.7 : 1 })}>
            <Ionicons name={icon} size={17} color={ink} style={{ marginRight: 6 }} />
            <Text style={{ color: ink, fontWeight: '800', fontSize: 14 }}>{label}{wait ? ` · ${wait}` : ''}</Text>
        </Pressable>
    );
}

export default function PickupActions({ order: o, onChanged }) {
    const { surface, border, text, muted, primary } = useBrand();
    const [busy, setBusy] = useState('');
    const [, tick] = useState(0);
    const said0 = o.pickupIntent;
    const waiting = !!said0?.at && Date.now() - new Date(said0.at).getTime() < COOL_MS;
    useEffect(() => {   // a second-by-second clock, only while a message is cooling down
        if (!waiting) return undefined;
        const t = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, [waiting]);
    if (o.orderType !== 'pickup' || o.status !== 'ready' || o.pickupClaim?.kind) return null;
    const late = !!o.scheduledFor && Date.now() > new Date(o.scheduledFor).getTime();
    const said = o.pickupIntent?.kind;
    // how long until the same message can be sent again, as 2:41 (nothing when it can)
    const wait = (kind) => {
        if (said !== kind || !o.pickupIntent?.at) return '';
        const left = COOL_MS - (Date.now() - new Date(o.pickupIntent.at).getTime());
        if (left <= 0) return '';
        const sec = Math.ceil(left / 1000);
        return `${tr('again in')} ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    };
    const sure = async (a, done) => {
        const [title, message, confirmText] = WORDS[a];
        if (await ask({ title: tr(title), message: tr(message), confirmText: tr(confirmText), cancelText: tr('Go back') })) send(a, done);
    };
    const send = async (a, done) => {
        setBusy(a);
        try { await answerPickup(o.id || o._id, a); showToast(done); onChanged?.(); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send that. Try again.')); } finally { setBusy(''); }
    };
    const cant = async () => {
        const yes = await ask({ title: tr('You cannot come?'), message: tr('We will tell the shop. They will decide about the refund and let you know.'), confirmText: tr('Yes, I cannot come') });
        if (yes) send('not_wanted', tr('We told the shop. They will get back to you.'));
    };
    return (
        <View style={{ marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Your food is ready')}</Text>
            <Text style={{ color: muted, fontSize: 13, marginTop: 2, marginBottom: 12 }}>
                {said ? `${tr(SAID[said])} · ${clock(o.pickupIntent.at)}` : late ? tr('Your pickup time has passed. Tell the shop what you will do.') : tr('Tell the shop when you are coming.')}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {!late ? <PickupChip icon="walk" label={tr("I'm coming")} busy={busy === 'coming'} wait={wait('coming')} onPress={() => sure('coming', tr('The shop knows you are coming.'))} /> : null}
                {late ? <PickupChip icon="walk" label={tr('On my way, sorry')} busy={busy === 'late'} wait={wait('late')} onPress={() => sure('late', tr('The shop knows you are on your way.'))} /> : null}
                {late ? <PickupChip icon="time" label={tr('Need more time')} busy={busy === 'more_time'} wait={wait('more_time')} onPress={() => sure('more_time', tr('We told the shop you need a little more time.'))} /> : null}
                <PickupChip icon="location" label={tr("I'm here")} busy={busy === 'arrived'} wait={wait('arrived')} onPress={() => sure('arrived', tr('The shop knows you are here.'))} />
                <PickupChip icon="checkmark-circle" label={tr('Got my food')} strong busy={busy === 'collected'} onPress={() => sure('collected', tr('Thank you! We told the shop.'))} />
                <PickupChip icon="close-circle" label={late ? tr("Can't take it") : tr("Can't come")} danger busy={busy === 'not_wanted'} onPress={cant} />
            </View>
        </View>
    );
}
