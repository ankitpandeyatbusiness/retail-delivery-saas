// Messages: send a notification to all your customers and/or riders, and see what you sent. 5 messages a day. Never by SMS.
import { usePlanHas } from '../../utils/owners/menuFlags';
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import { PageHeader, Card, Button, Pill, Sheet, Field, Chips, SectionTitle, Empty } from '../../components/owners/ui';
import { ToggleRow, Label, Hint } from '../../components/owners/menuBits';
import { fetchMessages, sendMessage, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { MESSAGE_STATUS, AUDIENCES } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr, tl } from '../../i18n';
import { UpgradeNote } from '../../components/owners/PlanLock';

const AUD_ICON = { customers: 'people', riders: 'bicycle', both: 'earth' };

function Compose({ visible, onClose, onSent }) {
    const desk = useOwnerDesktop();   // a computer: big choice tiles and a live preview of the notification
    const { text, muted, border, primary, onPrimary, surface } = useBrand();
    const pushOk = usePlanHas('customPush');   // messages to customers are the custom push (Pro); riders can always be messaged
    const [title, setTitle] = useState('');
    const [body, setBody] = useState('');
    const [audience, setAudience] = useState(pushOk ? 'customers' : 'riders');
    const [kind, setKind] = useState('info');
    const [busy, setBusy] = useState(false);
    const ok = title.trim().length >= 1 && body.trim().length >= 1;

    const send = async () => {
        const who = AUDIENCES.find((a) => a[0] === audience)[1].toLowerCase();
        const yes = await ask({ title: tr('Send this message?'), message: tr('It goes to all your {who} now. It cannot be taken back.', { who: who }), confirmText: tr('Send') });
        if (!yes) return;
        setBusy(true);
        try {
            await sendMessage({ title: title.trim(), body: body.trim(), audience, kind });
            showToast(tr('Sending. It reaches everyone in a few minutes.'));
            setTitle(''); setBody('');
            onSent(); onClose();
        } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    return (
        <Sheet visible={visible} onClose={onClose} title={tr('New message')}>
            {desk ? (
                <View>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 14, marginBottom: 10 }}>{tr('Send to')}</Text>
                    {!pushOk ? <UpgradeNote feature="customPush" text={tr('Send offers to your customers by push')} style={{ marginHorizontal: 0, marginBottom: 8 }} /> : null}
                    <View style={{ flexDirection: 'row', marginHorizontal: -5 }}>
                        {(pushOk ? AUDIENCES : AUDIENCES.filter((a) => a[0] === 'riders')).map(([k, label]) => {
                            const on = audience === k;
                            return (
                                <View key={k} style={{ flex: 1, padding: 5 }}>
                                    <Pressable onPress={() => { setAudience(k); if (k !== 'customers') setKind('info'); }} style={({ hovered }) => ({ alignItems: 'center', paddingVertical: 16, borderRadius: 18, borderWidth: 1.5, borderColor: on ? primary : hovered ? alpha(primary, 0.55) : border, backgroundColor: on ? primary : hovered ? alpha(primary, 0.07) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '140ms' })}>
                                        <Ionicons name={AUD_ICON[k] || 'people'} size={24} color={on ? onPrimary : primary} />
                                        <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 14, marginTop: 6 }}>{tr(label)}</Text>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </View>
                    {audience === 'customers' ? (
                        <View style={{ marginTop: 14 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 14, marginBottom: 10 }}>{tr('Kind')}</Text>
                            <View style={{ flexDirection: 'row', marginHorizontal: -5 }}>
                                {[['info', tl('Information'), 'information-circle'], ['promo', tl('Offer'), 'pricetag']].map(([k, label, ic]) => {
                                    const on = kind === k;
                                    return (
                                        <View key={k} style={{ flex: 1, padding: 5 }}>
                                            <Pressable onPress={() => setKind(k)} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 16, borderWidth: 1.5, borderColor: on ? primary : hovered ? alpha(primary, 0.55) : border, backgroundColor: on ? alpha(primary, 0.12) : hovered ? alpha(primary, 0.05) : 'transparent', cursor: 'pointer' })}>
                                                <Ionicons name={ic} size={18} color={primary} />
                                                <Text style={{ color: on ? primary : text, fontWeight: '800', fontSize: 14, marginLeft: 8 }}>{label}</Text>
                                            </Pressable>
                                        </View>
                                    );
                                })}
                            </View>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{kind === 'promo' ? tr('Customers who turned promotions off are skipped.') : tr('Important news, like closing for a day.')}</Text>
                        </View>
                    ) : null}
                    <View style={{ height: 16 }} />
                    <Field value={title} onChangeText={setTitle} placeholder={tr('Title (shown in bold)')} maxLength={120} style={{ marginBottom: 4 }} />
                    <Text style={{ color: muted, fontSize: 11.5, textAlign: 'right', marginBottom: 8 }}>{title.length}/120</Text>
                    <Field value={body} onChangeText={setBody} placeholder={tr('Message')} multiline maxLength={1000} style={{ marginBottom: 4, minHeight: 90 }} />
                    <Text style={{ color: muted, fontSize: 11.5, textAlign: 'right', marginBottom: 12 }}>{body.length}/1000</Text>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 14, marginBottom: 8 }}>{tr('How it looks')}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 18, backgroundColor: alpha(muted, 0.1) }}>
                        <View style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: primary, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="notifications" size={22} color={onPrimary} /></View>
                        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                            <Text style={{ color: title ? text : muted, fontWeight: '900', fontSize: 14.5 }} numberOfLines={1}>{title || tr('Your title')}</Text>
                            <Text style={{ color: muted, fontSize: 13, marginTop: 1 }} numberOfLines={2}>{body || tr('Your message appears here')}</Text>
                        </View>
                        <Text style={{ color: muted, fontSize: 11.5, alignSelf: 'flex-start' }}>{tr('now')}</Text>
                    </View>
                    <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>{tr('It reaches people as a notification and in their app inbox.')}</Text>
                    <View style={{ marginTop: 14 }}><Button label={tr('Send message')} icon="send" disabled={!ok} busy={busy} onPress={send} /></View>
                </View>
            ) : null}
            {desk ? null : <>
            <Label>{tr('Send to')}</Label>
            {!pushOk ? <UpgradeNote feature="customPush" text={tr('Send offers to your customers by push')} style={{ marginHorizontal: 0, marginBottom: 8 }} /> : null}
            <Chips options={pushOk ? AUDIENCES : AUDIENCES.filter((a) => a[0] === 'riders')} value={audience} onChange={(a) => { setAudience(a); if (a !== 'customers') setKind('info'); }} style={{ marginTop: 0 }} />
            <Label hint={kind === 'promo' ? tr('Customers who turned promotions off are skipped.') : tr('Important news, like closing for a day.')}>{tr('Kind')}</Label>
            <Chips options={audience === 'customers' ? [['info', tl('Information')], ['promo', tl('Offer')]] : [['info', tl('Information')]]} value={kind} onChange={setKind} style={{ marginTop: 0 }} />
            <View style={{ height: 6 }} />
            <Field value={title} onChangeText={setTitle} placeholder={tr('Title (shown in bold)')} maxLength={120} style={{ marginBottom: 10 }} />
            <Field value={body} onChangeText={setBody} placeholder={tr('Message')} multiline maxLength={1000} style={{ marginBottom: 6 }} />
            <Hint>{tr('It reaches people as a notification and in their app inbox.')}</Hint>
            <View style={{ height: 12 }} />
            <Button label={tr('Send message')} icon="send" disabled={!ok} busy={busy} onPress={send} />
            </>}
        </Sheet>
    );
}

export default function OwnerMessagesScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, and what you sent as cards two across
    const gcols = useGridCols(2, 420);   // fewer, wider cards in a narrow window
    const pushOk = usePlanHas('customPush');   // messages to customers are the custom push (Pro); riders can always be messaged
    const { background, text, muted, ok, error, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [err, setErr] = useState('');
    const [writing, setWriting] = useState(false);

    const load = useCallback(async () => {
        try { setItems((await fetchMessages()).items); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your messages.')); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => {
        load();
        const t = setInterval(load, 8000);   // progress of a message that is still sending
        return () => clearInterval(t);
    }, [load]));

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Messages')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero icon="megaphone" title={tr('Messages')} subtitle={tr('Tell your customers and riders about a new dish, an offer or a holiday. Up to 5 a day.')}
                        right={<HeroBtn label={tr('New message')} icon="create-outline" solid onPress={() => setWriting(true)} />}>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            <GlassStat label={tr('Sent')} value={items ? String(items.length) : '–'} icon="paper-plane-outline" />
                            <GlassStat label={tr('Sending now')} value={items ? String(items.filter((m) => ['queued', 'sending'].includes(m.status)).length) : '–'} icon="hourglass-outline" />
                            <GlassStat label={tr('Failed')} value={items ? String(items.filter((m) => m.status === 'failed').length) : '–'} icon="alert-circle-outline" />
                        </View>
                    </Hero>
                ) : null}
                {desk ? null : <View style={{ paddingHorizontal: 16, marginBottom: 6 }}>
                    <Button label={tr('New message')} icon="create" onPress={() => setWriting(true)} />
                    <Hint>{tr('Up to 5 messages a day. They arrive as notifications in the app.')}</Hint>
                </View>}
                {desk ? null : <SectionTitle title={tr('Sent')} />}
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="megaphone-outline" title={tr('No messages yet')} hint={tr('Tell your customers about a new dish, an offer or a holiday.')} /> : null}
                {desk ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                        {(items || []).map((m) => (
                            <View key={m.id} style={{ width: `${100 / gcols}%`, padding: 8 }}>
                                <View style={{ borderRadius: 22, borderWidth: 1, borderColor: alpha(muted, 0.25), padding: 18 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={AUD_ICON[m.audience] || 'people'} size={22} color={primary} /></View>
                                        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{m.title}</Text>
                                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }}>{ago(m.createdAt)} · {m.audience === 'both' ? tr('Customers and riders') : m.audience === 'riders' ? tr('Riders') : tr('Customers')}</Text>
                                        </View>
                                        <Pill label={MESSAGE_STATUS[m.status] || m.status} color={m.status === 'failed' ? error : m.status === 'done' ? ok : primary} />
                                    </View>
                                    <Text style={{ color: text, marginTop: 12, lineHeight: 20 }} numberOfLines={4}>{m.body}</Text>
                                </View>
                            </View>
                        ))}
                    </View>
                ) : null}
                {desk ? null : (items || []).map((m) => (
                    <Card key={m.id}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', flex: 1 }} numberOfLines={1}>{m.title}</Text>
                            <Pill label={MESSAGE_STATUS[m.status] || m.status} color={m.status === 'failed' ? error : m.status === 'done' ? ok : primary} />
                        </View>
                        <Text style={{ color: muted, marginTop: 4 }} numberOfLines={3}>{m.body}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('To {v1} · {ago} {v3}{v4}{v5}', { v1: m.audience === 'both' ? 'customers and riders' : m.audience, ago: ago(m.createdAt), v3: ` · ${m.sent}/${m.recipients} delivered`, v4: m.failed ? ` · ${m.failed} failed` : '', v5: m.skippedOptOut ? ` · ${m.skippedOptOut} skipped (promotions off)` : '' })}</Text>
                    </Card>
                ))}
              </Frame>
            </ScrollView>
            <Compose visible={writing} onClose={() => setWriting(false)} onSent={load} />
        </View>
    );
}
