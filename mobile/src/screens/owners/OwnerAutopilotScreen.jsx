// Autopilot: reminders to customers that go out by themselves, and summaries for the owner.
// Push notification and the app inbox only (no SMS, no email). Every change is saved at once.
// The recommended settings are shown, and "Reset to recommended" brings them all back.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Card, Button, Sheet, Field, SectionTitle, Stat, Empty, money } from '../../components/owners/ui';
import { FormPage, Group, ToggleRow, ChoiceBox, Hint, Label } from '../../components/owners/menuBits';
import { fetchAutopilot, saveAutopilot, fetchAutopilotLibrary, fetchAutopilotStats, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { ago } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const CUSTOMER_ROWS = [
    ['winback', 'Bring back customers who stopped ordering', 'A friendly nudge at the hour they usually order, then a small offer, then a last call. Three messages at most, then they are left alone for a month. It stops the moment they order.'],
    ['welcome', 'Welcome after the first order', 'A warm hello after a new customer’s first delivery'],
    ['thanks', 'Thank you after a delivery', 'A short thank you, at most once in 3 days to one person'],
    ['mealtime', 'Meal-time reminder', 'Before the hour a regular customer usually orders: “Lunch time? Your Paneer Roll is ready”'],
    ['festival', 'Festival greetings', 'Diwali, Dussehra, New Year and a few other days, to people who ordered in the last 3 months'],
];
const OWNER_ROWS = [
    ['dailySummary', 'Daily summary for you', 'How today went, as a notification at the time you choose (only on days with orders)'],
    ['weeklyDigest', 'Monday digest for you', 'How last week went, every Monday morning'],
];
const LANGS = [['en', 'English'], ['hinglish', 'Hinglish'], ['hi', 'हिंदी']];
const FREQ = [['gentle', 'Gentle'], ['normal', 'Normal'], ['pushy', 'Pushy']];
const FREQ_NOTE = {
    gentle: 'Recommended. A week between win-back messages, and 2 promotional messages a week to one customer at most.',
    normal: 'Three days between win-back messages, 3 messages a week at most.',
    pushy: 'Two days between win-back messages, 4 messages a week at most. Customers who feel spammed switch notifications off, so use with care.',
};
const QUIET = [['21-9', '9 PM to 9 AM'], ['22-8', '10 PM to 8 AM'], ['20-10', '8 PM to 10 AM']];
const SUMMARY = [[21, '9 PM'], [22, '10 PM'], [23, '11 PM']];
const DISCOUNT = [[0, 'No offer'], [5, '5%'], [10, '10%'], [15, '15%'], [20, '20%']];
const KIND_LABEL = { winback: 'Win-back', welcome: 'Welcome', thanks: 'Thank you', mealtime: 'Meal-time', festival: 'Festival', manual: 'Remind button' };

function MessagesSheet({ visible, onClose, onChanged }) {
    const { text, muted, border, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [edit, setEdit] = useState(null);
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => { fetchAutopilotLibrary().then((r) => setItems(r.items)).catch((e) => showToast(apiError(e))); }, []);
    useEffect(() => { if (visible) load(); }, [visible, load]);
    const open = (m) => { setEdit(m); setTitle(m.custom?.title || m.sample.title); setBody(m.custom?.body || m.sample.body); };
    const save = async (custom) => {
        setBusy(true);
        try {
            await saveAutopilot({ custom: { [edit.kind]: custom } });
            showToast(custom ? tr('Saved') : tr('Back to the app’s messages'));
            setEdit(null); load(); onChanged();
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    if (edit) {
        return (
            <Sheet visible={visible} onClose={() => setEdit(null)} title={edit.name}>
                <Hint>{tr('Write it your way. Words in curly brackets are filled in for each customer: {name} {food} {shop} {discount} {code}')}</Hint>
                <View style={{ height: 8 }} />
                <Label>{tr('Title')}</Label>
                <Field value={title} onChangeText={setTitle} maxLength={60} />
                <View style={{ height: 10 }} />
                <Label>{tr('Message')}</Label>
                <Field value={body} onChangeText={setBody} multiline maxLength={200} style={{ minHeight: 70 }} />
                <View style={{ height: 14 }} />
                <Button label={tr('Save my wording')} icon="checkmark" busy={busy} disabled={!title.trim() || !body.trim()} onPress={() => save({ title: title.trim(), body: body.trim() })} />
                {edit.custom ? <View style={{ marginTop: 8 }}><Button label={tr('Use the app’s messages again')} kind="ghost" icon="refresh" busy={busy} onPress={() => save(null)} /></View> : null}
            </Sheet>
        );
    }
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Your messages')}>
            <Hint>{tr('There are many ready-made messages in each group. Autopilot picks a different one each time and never repeats the same one to a customer within 30 days. Tap one to write your own wording instead.')}</Hint>
            {items === null ? <FormShimmer /> : items.map((m) => (
                <Pressable key={m.kind} onPress={() => open(m)} style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: border }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: text, fontWeight: '800' }}>{m.name}</Text>
                        <Text style={{ color: m.custom ? primary : muted, fontSize: 11, fontWeight: '800' }}>{m.custom ? tr('YOUR WORDING') : tr('{variants} ready-made', { variants: m.variants })}</Text>
                    </View>
                    <Text style={{ color: text, marginTop: 4, fontSize: 13 }} numberOfLines={1}>{m.sample.title}</Text>
                    <Text style={{ color: muted, fontSize: 12 }} numberOfLines={2}>{m.sample.body}</Text>
                </Pressable>
            ))}
        </Sheet>
    );
}

export default function OwnerAutopilotScreen() {
    const { text, muted, primary, error } = useBrand();
    const [cfg, setCfg] = useState(null);
    const [stats, setStats] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [library, setLibrary] = useState(false);

    const load = useCallback(() => {
        fetchAutopilot().then((r) => { setCfg(r); setErr(''); }).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open Autopilot.')); });
        fetchAutopilotStats(30).then(setStats).catch(() => { });
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!cfg) return <FormPage title={tr('Autopilot')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;

    // the screen changes at once; the server confirms (or we put it back)
    const change = async (patch, optimistic) => {
        const before = cfg;
        setCfg((c) => ({ ...c, ...optimistic }));
        try { setCfg(await saveAutopilot(patch)); } catch (e) { setCfg(before); showToast(apiError(e)); }
    };
    const toggle = (key, v) => change({ on: { [key]: v } }, { on: { ...cfg.on, [key]: v } });
    const anyOn = Object.values(cfg.on).some(Boolean);
    const isRec = () => cfg.frequency === cfg.recommended.frequency && cfg.language === cfg.recommended.language && cfg.maxDiscount === cfg.recommended.maxDiscount
        && cfg.quietFrom === cfg.recommended.quietFrom && cfg.quietTo === cfg.recommended.quietTo && cfg.summaryHour === cfg.recommended.summaryHour
        && Object.keys(cfg.recommended.on).every((k) => cfg.on[k] === cfg.recommended.on[k]);

    const recommend = async (confirm) => {
        if (confirm) {
            const yes = await ask({ title: tr('Reset to recommended?'), message: tr('Every Autopilot setting goes back to what we recommend. Your own wording of messages is removed.'), confirmText: tr('Reset') });
            if (!yes) return;
        }
        setBusy(true);
        try { setCfg(await saveAutopilot({ recommended: true })); showToast(confirm ? tr('Back to recommended') : tr('Autopilot is on')); }
        catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    const quiet = `${cfg.quietFrom}-${cfg.quietTo}`;
    return (
        <FormPage title={tr('Autopilot')}>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="rocket" size={22} color={primary} />
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, marginLeft: 10, flex: 1 }}>{tr('Customers come back, without you chasing them')}</Text>
                </View>
                <Text style={{ color: muted, marginTop: 8, fontSize: 13 }}>{tr('Autopilot sends friendly reminders by notification and in the customer’s app inbox. No SMS, no email, nothing from your SMS balance. You do not have to watch it.')}</Text>
                <Text style={{ color: muted, marginTop: 6, fontSize: 12 }}>{tr('Safety: never to someone who ordered today, never at night, never more than {weeklyCap} a week to one person, and never to someone who turned offers off.', { weeklyCap: cfg.limits.weeklyCap })}</Text>
                {cfg.platformPaused ? <Text style={{ color: error, fontWeight: '800', marginTop: 8 }}>{tr('Autopilot is paused for your shop by the platform. Contact support.')}</Text> : null}
                {!anyOn ? <View style={{ marginTop: 12 }}><Button label={tr('Turn on recommended')} icon="flash" busy={busy} onPress={() => recommend(false)} /></View> : null}
            </Card>

            {stats && stats.sent > 0 ? (
                <>
                    <SectionTitle title={tr('Last 30 days')} />
                    <Card>
                        <View style={{ flexDirection: 'row' }}>
                            <Stat label={tr('Messages sent')} value={String(stats.sent)} />
                            <Stat label={tr('Came back')} value={String(stats.broughtBack)} color={stats.broughtBack ? primary : undefined} />
                            <Stat label={tr('Sales from them')} value={money(stats.revenue)} />
                        </View>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('“Came back” means the customer ordered within 3 days of a message.')}</Text>
                    </Card>
                </>
            ) : null}

            <Group title={tr('Messages to your customers')} hint={tr('Switch on what you want.')}>
                {CUSTOMER_ROWS.map(([k, title, sub], i) => <ToggleRow key={k} title={title} subtitle={sub} value={cfg.on[k]} onValueChange={(v) => toggle(k, v)} last={i === CUSTOMER_ROWS.length - 1} />)}
            </Group>
            <Group title={tr('Messages to you')}>
                {OWNER_ROWS.map(([k, title, sub], i) => <ToggleRow key={k} title={title} subtitle={sub} value={cfg.on[k]} onValueChange={(v) => toggle(k, v)} last={i === OWNER_ROWS.length - 1} />)}
                {cfg.on.dailySummary ? <View style={{ marginTop: 12 }}><ChoiceBox label={tr('Daily summary time')} options={SUMMARY} value={cfg.summaryHour} onChange={(v) => change({ summaryHour: v }, { summaryHour: v })} last /></View> : null}
            </Group>

            <Group title={tr('How it speaks')} hint={tr('Recommended: Hinglish, Gentle, 10% offer, quiet at night.')}>
                <ChoiceBox label={tr('Language of the messages')} options={LANGS} value={cfg.language} onChange={(v) => change({ language: v }, { language: v })} />
                <ChoiceBox label={tr('How often')} hint={FREQ_NOTE[cfg.frequency]} options={FREQ} value={cfg.frequency} onChange={(v) => change({ frequency: v }, { frequency: v, limits: { ...cfg.limits, weeklyCap: v === 'gentle' ? 2 : v === 'normal' ? 3 : 4 } })} />
                <ChoiceBox label={tr('Offer in the win-back (a one-time code)')} hint={tr('The second win-back message can carry a discount code, valid for 5 days.')} options={DISCOUNT} value={cfg.maxDiscount} onChange={(v) => change({ maxDiscount: v }, { maxDiscount: v })} />
                <ChoiceBox label={tr('Quiet hours (no reminders to customers)')} options={QUIET} value={QUIET.some((q) => q[0] === quiet) ? quiet : null} onChange={(v) => { const [a, b] = v.split('-').map(Number); change({ quietFrom: a, quietTo: b }, { quietFrom: a, quietTo: b }); }} last />
                <View style={{ marginTop: 12 }}><Button label={tr('See and edit the messages')} icon="create" kind="ghost" onPress={() => setLibrary(true)} /></View>
            </Group>

            <View style={{ paddingHorizontal: 16, marginTop: 8 }}>
                <Button label={isRec() ? tr('Using the recommended settings') : tr('Reset to recommended')} icon="refresh" kind="ghost" disabled={isRec()} busy={busy} onPress={() => recommend(true)} />
            </View>

            {stats?.recent?.length ? (
                <>
                    <SectionTitle title={tr('Recently sent')} />
                    <Card>
                        {stats.recent.slice(0, 8).map((r, i) => (
                            <View key={`${r.at}-${i}`} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: alpha(muted, 0.2) }}>
                                <Text style={{ color: text, fontWeight: '700', fontSize: 13 }} numberOfLines={1}>{r.title}</Text>
                                <Text style={{ color: muted, fontSize: 12 }}>{r.customer || tr('Customer')} · {KIND_LABEL[r.kind.replace(/_\d$/, '')] || r.kind}{r.by === 'owner' ? tr(' (by you)') : ''} · {ago(r.at)}</Text>
                            </View>
                        ))}
                    </Card>
                </>
            ) : null}
            <MessagesSheet visible={library} onClose={() => setLibrary(false)} onChanged={load} />
        </FormPage>
    );
}
