// One service: what customers read, the price, the questions they answer (ours and the owner's own, as many as he likes).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty, Card } from '../../components/owners/ui';
import { FormPage, Group, TextBox, NumberBox, ChoiceBox, ToggleRow, Hint, MorePictures } from '../../components/owners/menuBits';
import { services as api, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { FormShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

const TYPE_LABEL = {
    text: 'Short text', longtext: 'Long text', number: 'Number', date: 'Date', time: 'Time', yesno: 'Yes / No',
    choice: 'Pick one', multichoice: 'Pick many', phone: 'Phone', address: 'Address', photo: 'Photo',
};
const PRICE_TYPES = [['per_plate', 'Per plate'], ['fixed', 'Fixed'], ['from', 'Starting from'], ['per_month', 'Per month'], ['quote', 'On quote']];
const lines = (v) => String(v || '').split('\n').map((x) => x.trim()).filter(Boolean);
const toText = (a) => (a || []).join('\n');
const BLANK_Q = { id: '', type: 'text', label: '', hint: '', required: false, enabled: true, recommended: false, options: [] };

export default function OwnerServiceScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const { text, muted, primary, border } = useBrand();
    const [form, setForm] = useState(null);
    const [err, setErr] = useState('');
    const [saving, setSaving] = useState(false);
    const [open, setOpen] = useState(-1);   // the question being edited
    const [copyIdx, setCopyIdx] = useState(-1);   // the question whose "copy to" list is showing
    const [others, setOthers] = useState([]);

    const fill = (r) => setForm({
        kind: r.kind, name: r.name || '', description: r.description || '', photos: r.photos || [], priceType: r.priceType, price: r.price || undefined,
        minGuests: r.minGuests || undefined, noticeHours: r.noticeHours || undefined, bullets: toText(r.bullets), quickTexts: toText(r.quickTexts),
        quickReplies: toText(r.quickReplies), questions: (r.questions || []).map((q) => ({ ...q, options: q.options || [] })), isActive: r.isActive !== false,
    });
    useEffect(() => {
        api.get(id).then(fill).catch((e) => { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open this service.')); });
    }, [id]);

    if (!form) return <FormPage title={tr('Service')}>{err ? <Empty icon="cloud-offline-outline" title={tr('Could not open')} hint={err} /> : <FormShimmer />}</FormPage>;
    const v = form;
    const set = (k, x) => setForm((f) => ({ ...f, [k]: x }));
    const setQ = (i, patch) => set('questions', v.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
    const move = (i, d) => {
        const j = i + d;
        if (j < 0 || j >= v.questions.length) return;
        const next = [...v.questions]; [next[i], next[j]] = [next[j], next[i]];
        set('questions', next); setOpen(j);
    };

    const save = async () => {
        setSaving(true);
        try {
            const body = {
                name: v.name.trim(), description: v.description.trim(), photos: v.photos, priceType: v.priceType, price: v.price ?? 0,
                minGuests: v.minGuests ?? 0, noticeHours: v.noticeHours ?? 0, bullets: lines(v.bullets), quickTexts: lines(v.quickTexts),
                quickReplies: lines(v.quickReplies), isActive: v.isActive,
                questions: v.questions.map((q) => ({ ...q, options: q.type === 'choice' || q.type === 'multichoice' ? q.options : [] })),
            };
            fill(await api.update(id, body)); setOpen(-1);
            showToast(tr('Service saved'));
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const recommended = async () => {
        const yes = await ask({ title: tr('Use our recommended questions?'), message: tr('Our questions come back switched on. Your own questions stay. Changes you made to our questions are undone.'), confirmText: tr('Use recommended') });
        if (!yes) return;
        try { fill(await api.useRecommended(id)); setOpen(-1); showToast(tr('Recommended questions are back')); }
        catch (e) { showToast(apiError(e)); }
    };

    const remove = async () => {
        const yes = await ask({ title: tr('Remove this service?'), message: tr('Customers will not see it any more. Inquiries already sent stay.'), confirmText: tr('Remove'), destructive: true });
        if (!yes) return;
        try { await api.remove(id); showToast(tr('Service removed')); nav.goBack(); } catch (e) { showToast(apiError(e)); }
    };

    // copy one question into another service (the server needs the question saved, so a new unsaved one is refused here)
    const openCopy = async (i, q) => {
        if (!q.id) return showToast(tr('Save the service first, then copy this question'));
        if (copyIdx === i) return setCopyIdx(-1);
        try {
            const r = await api.list();
            setOthers((Array.isArray(r) ? r : r.items || []).filter((o) => String(o._id || o.id) !== String(id)));
            setCopyIdx(i);
        } catch (e) { showToast(apiError(e)); }
    };
    const copyTo = async (q, o) => {
        try { await api.copyQuestion(id, { questionId: q.id, toServiceId: o._id || o.id }); setCopyIdx(-1); showToast(tr('Copied to {n}', { n: o.name })); }
        catch (e) { showToast(apiError(e)); }
    };

    const choices = (q) => q.type === 'choice' || q.type === 'multichoice';

    return (
        <FormPage title={v.name || tr('Service')} footer={<Button label={tr('Save changes')} icon="checkmark" busy={saving} onPress={save} />}>
            <Group title={tr('What customers read')}>
                <TextBox label={tr('Service name')} value={v.name} onChangeText={(x) => set('name', x)} maxLength={80} placeholder={tr('e.g. Cake order')} />
                <TextBox label={tr('About this service')} value={v.description} onChangeText={(x) => set('description', x)} multiline maxLength={1000} placeholder={tr('What is included, how it works')} />
                <TextBox label={tr('Points to show (one per line)')} value={v.bullets} onChangeText={(x) => set('bullets', x)} multiline maxLength={800} placeholder={tr('Includes 2 sweets\nBook 2 days ahead')} last />
                <MorePictures value={v.photos} onChange={(x) => set('photos', x)} kind="service" max={5} label={tr('Photos')} />
            </Group>
            <Group title={tr('Price')}>
                <ChoiceBox label={tr('How you charge')} options={PRICE_TYPES.map(([k, l]) => [k, tr(l)])} value={v.priceType} onChange={(x) => set('priceType', x)} />
                {v.priceType !== 'quote' ? <NumberBox label={tr('Amount')} prefix="₹" integer value={v.price} onChange={(x) => set('price', x)} /> : null}
                <NumberBox label={tr('Fewest guests (optional)')} integer value={v.minGuests} onChange={(x) => set('minGuests', x)} />
                <NumberBox label={tr('Notice needed, in hours (optional)')} integer value={v.noticeHours} onChange={(x) => set('noticeHours', x)} last />
            </Group>
            <Group title={tr('Questions the customer answers')} hint={tr('Name and phone are always asked. Switch a question off to hide it, or add your own below.')}>
                <Button label={tr('Use recommended settings')} icon="sparkles" kind="ghost" onPress={recommended} style={{ marginBottom: 10 }} />
                {v.questions.map((q, i) => (
                    <Card key={q.id || `n${i}`} style={{ marginHorizontal: 0, opacity: q.enabled ? 1 : 0.6 }}>
                        <Pressable onPress={() => setOpen(open === i ? -1 : i)} style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '800', fontSize: 15 }}>{q.label || tr('New question')}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{tr(TYPE_LABEL[q.type])}{q.required ? ` · ${tr('required')}` : ''}{q.recommended ? '' : ` · ${tr('yours')}`}</Text>
                            </View>
                            <Ionicons name={open === i ? 'chevron-up' : 'chevron-down'} size={18} color={muted} style={{ marginRight: 10 }} />
                            <Pressable onPress={() => setQ(i, { enabled: !q.enabled })} hitSlop={8}>
                                <Ionicons name={q.enabled ? 'toggle' : 'toggle-outline'} size={38} color={q.enabled ? primary : muted} />
                            </Pressable>
                        </Pressable>
                        {open === i ? (
                            <View style={{ marginTop: 12, borderTopWidth: 1, borderTopColor: border, paddingTop: 12 }}>
                                <TextBox label={tr('Question')} value={q.label} onChangeText={(x) => setQ(i, { label: x })} maxLength={200} />
                                <TextBox label={tr('Hint under it (optional)')} value={q.hint} onChangeText={(x) => setQ(i, { hint: x })} maxLength={200} />
                                <ChoiceBox label={tr('Answer type')} options={Object.keys(TYPE_LABEL).map((k) => [k, tr(TYPE_LABEL[k])])} value={q.type} onChange={(x) => setQ(i, { type: x })} />
                                {choices(q) ? <TextBox label={tr('Choices (one per line)')} value={toText(q.options)} onChangeText={(x) => setQ(i, { options: x.split('\n') })} multiline maxLength={800} hint={tr('At least two')} /> : null}
                                {q.type === 'number' ? (
                                    <View style={{ flexDirection: 'row' }}>
                                        <View style={{ flex: 1, marginRight: 8 }}><NumberBox label={tr('Lowest')} value={q.min} onChange={(x) => setQ(i, { min: x })} /></View>
                                        <View style={{ flex: 1 }}><NumberBox label={tr('Highest')} value={q.max} onChange={(x) => setQ(i, { max: x })} /></View>
                                    </View>
                                ) : null}
                                <ToggleRow title={tr('Customer must answer')} value={q.required} onValueChange={(x) => setQ(i, { required: x })} last />
                                {copyIdx === i ? (
                                    <View style={{ marginTop: 10 }}>
                                        <Text style={{ color: muted, fontSize: 12, marginBottom: 6 }}>{tr('Copy this question to:')}</Text>
                                        {others.length ? others.map((o) => (
                                            <Button key={o._id || o.id} label={o.name} icon="arrow-forward" kind="ghost" onPress={() => copyTo(q, o)} style={{ marginBottom: 6 }} />
                                        )) : <Text style={{ color: muted }}>{tr('You have no other service yet')}</Text>}
                                    </View>
                                ) : null}
                                <View style={{ flexDirection: 'row', marginTop: 10 }}>
                                    <Button label="" icon="arrow-up" kind="ghost" iconOnly onPress={() => move(i, -1)} disabled={i === 0} style={{ marginRight: 8 }} />
                                    <Button label="" icon="arrow-down" kind="ghost" iconOnly onPress={() => move(i, 1)} disabled={i === v.questions.length - 1} style={{ marginRight: 8 }} />
                                    <Button label="" icon="copy-outline" kind="ghost" iconOnly onPress={() => { set('questions', [...v.questions.slice(0, i + 1), { ...q, id: '', recommended: false }, ...v.questions.slice(i + 1)]); setOpen(i + 1); }} style={{ marginRight: 8 }} />
                                    <Button label="" icon="share-outline" kind="ghost" iconOnly onPress={() => openCopy(i, q)} style={{ marginRight: 8 }} />
                                    <Button label={tr('Delete')} icon="trash" kind="danger" onPress={() => { set('questions', v.questions.filter((_, j) => j !== i)); setOpen(-1); }} style={{ flex: 1 }} />
                                </View>
                            </View>
                        ) : null}
                    </Card>
                ))}
                <Button label={tr('Add my own question')} icon="add" onPress={() => { set('questions', [...v.questions, { ...BLANK_Q }]); setOpen(v.questions.length); }} />
            </Group>
            <Group title={tr('Message helpers')}>
                <TextBox label={tr('Tap-to-fill texts for the customer (one per line)')} value={v.quickTexts} onChangeText={(x) => set('quickTexts', x)} multiline maxLength={1500} />
                <TextBox label={tr('Quick replies for you (one per line)')} value={v.quickReplies} onChangeText={(x) => set('quickReplies', x)} multiline maxLength={2500} placeholder={tr('Yes, available. Price is ₹1000 per plate')} last />
            </Group>
            <Group title={tr('Show it')}>
                <ToggleRow title={tr('Service is on')} subtitle={tr('Off: customers do not see it')} value={v.isActive} onValueChange={(x) => set('isActive', x)} last />
            </Group>
            <View style={{ paddingHorizontal: 16, marginTop: 8 }}><Button label={tr('Remove this service')} kind="danger" icon="trash" onPress={remove} /></View>
        </FormPage>
    );
}
