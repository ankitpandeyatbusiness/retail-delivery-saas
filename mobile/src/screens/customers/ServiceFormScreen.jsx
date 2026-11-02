// One service: photos, price and points on top, then the inquiry form (the shop owner chose the questions).
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, TimeBox, NumberBox, ChoiceBox, ToggleRow, Label } from '../../components/owners/menuBits';
import DateRangeSheet from '../../components/customers/DateRangeSheet';
import { fetchService, sendInquiry } from '../../api/customers/shopApi';
import { FormShimmer, LineShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { maskTime } from '../../utils/owners/menuRules';
import { priceLine } from '../owners/OwnerServicesScreen';
import PhotoCarousel from '../../components/customers/PhotoCarousel';
import { AddressSheet, addrLine } from '../../components/customers/addresses';
import { pickPhoto, uploadInquiryPhoto } from '../../utils/common/photoUpload';
import { tr } from '../../i18n';

const dayText = (k) => { const [y, m, d] = String(k).split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }); };

export default function ServiceFormScreen() {
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const { text, muted, primary, onPrimary, border, surface } = useBrand();
    const [s, setS] = useState(null);
    const [err, setErr] = useState('');
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [message, setMessage] = useState('');
    const [answers, setAnswers] = useState({});
    const [busy, setBusy] = useState(false);
    const [up, setUp] = useState('');           // id of the photo question being uploaded
    const [addrFor, setAddrFor] = useState('');  // id of the address question the saved-address sheet is open for
    const [dateFor, setDateFor] = useState('');  // id of the date question the day picker is open for

    useEffect(() => {
        fetchService(id).then((r) => { setS(r); setName(r.me?.name || ''); setPhone(r.me?.phone || ''); })
            .catch((e) => setErr(e?.response?.data?.error || tr('This service is not available')));
    }, [id]);

    if (!s) return <FormPage title={tr('Service')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k, x) => setAnswers((a) => ({ ...a, [k]: x }));
    const asked = s.questions || [];
    const pickFor = async (q, source) => {
        setUp(q.id);
        try {
            const p = await pickPhoto(source);
            if (!p) return;
            const m = await uploadInquiryPhoto(p);
            set(q.id, [...(Array.isArray(answers[q.id]) ? answers[q.id] : []), m.url].slice(0, 3));
        } catch (e) { showToast(e?.safe ? e.message : tr('Could not add the photo')); } finally { setUp(''); }
    };
    const guests = Number(answers.guests ?? answers.plates ?? 0);
    const estimate = s.priceType === 'per_plate' && s.price > 0 && guests > 0 ? s.price * guests : 0;

    const send = async () => {
        if (s.paused) return showToast(tr('Sorry, this service is temporarily unavailable.'));
        if (!name.trim()) return showToast(tr('Please enter your name'));
        if (phone.replace(/\D/g, '').length < 6) return showToast(tr('Please enter your phone number'));
        for (const q of asked) {
            const v = answers[q.id];
            if (q.required && q.type !== 'yesno' && (v === undefined || v === '' || (Array.isArray(v) && !v.length))) return showToast(tr('Please answer: {q}', { q: tr(q.label) }));
        }
        setBusy(true);
        try {
            await sendInquiry(id, { name: name.trim(), phone: phone.trim(), message: ((s.quickTexts || []).find((t) => tr(t) === message.trim()) || message.trim()), answers });
            showToast(tr('Inquiry sent. The shop will reply here.'));
            nav.replace('MyInquiries');
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Try again.')); } finally { setBusy(false); }
    };

    const field = (q) => {
        const v = answers[q.id];
        const common = { label: tr(q.label) + (q.required ? ' *' : ''), hint: q.hint ? tr(q.hint) : undefined };
        switch (q.type) {
            case 'number': return <NumberBox key={q.id} {...common} value={v} onChange={(x) => set(q.id, x)} />;
            case 'date': return (
                <View key={q.id} style={{ marginBottom: 16 }}>
                    <Label hint={common.hint}>{common.label}</Label>
                    <Pressable onPress={() => setDateFor(q.id)} style={{ minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: border, backgroundColor: surface, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={{ flex: 1, color: v ? text : muted, fontSize: 15, fontWeight: '600' }}>{v ? dayText(v) : tr('Tap to pick a day')}</Text>
                        <Ionicons name="calendar-outline" size={18} color={muted} />
                    </Pressable>
                </View>
            );
            case 'time': return <TimeBox key={q.id} {...common} value={v || ''} onChange={(x) => set(q.id, x)} placeholder="19:30" optional={!q.required} />;
            case 'yesno': return <ToggleRow key={q.id} title={tr(q.label)} subtitle={q.hint ? tr(q.hint) : undefined} value={!!v} onValueChange={(x) => set(q.id, x)} />;
            case 'choice': return <ChoiceBox key={q.id} {...common} options={q.options.map((o) => [o, tr(o)])} value={v} onChange={(x) => set(q.id, x)} />;
            case 'multichoice': {
                const picked = Array.isArray(v) ? v : [];
                return (
                    <View key={q.id} style={{ marginBottom: 12 }}>
                        <Label hint={common.hint}>{common.label}</Label>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                            {q.options.map((o) => {
                                const on = picked.includes(o);
                                return (
                                    <Pressable key={o} onPress={() => set(q.id, on ? picked.filter((x) => x !== o) : [...picked, o])} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
                                        <Text style={{ color: on ? onPrimary : text, fontWeight: '800' }}>{tr(o)}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>
                );
            }
            case 'phone': return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} keyboardType="phone-pad" maxLength={20} />;
            case 'photo': {
                const pics = Array.isArray(v) ? v : [];
                return (
                    <View key={q.id} style={{ marginBottom: 12 }}>
                        <Label hint={common.hint}>{common.label}</Label>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 }}>
                            {pics.map((u) => (
                                <Pressable key={u} onPress={() => set(q.id, pics.filter((x) => x !== u))} style={{ marginRight: 8, marginBottom: 8 }}>
                                    <Image source={{ uri: u }} contentFit="cover" style={{ width: 76, height: 76, borderRadius: 10 }} />
                                    <Ionicons name="close-circle" size={20} color={text} style={{ position: 'absolute', top: -6, right: -6 }} />
                                </Pressable>
                            ))}
                            {pics.length < 3 ? (
                                <>
                                    {up === q.id ? <View style={{ marginRight: 8 }}><LineShimmer width={76} height={76} /></View> : null}
                                    <Pressable disabled={!!up} onPress={() => pickFor(q, 'camera')} style={{ width: 76, height: 76, borderRadius: 10, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center', marginRight: 8 }}>
                                        <Ionicons name="camera-outline" size={26} color={muted} />
                                    </Pressable>
                                    <Pressable disabled={!!up} onPress={() => pickFor(q, 'gallery')} style={{ width: 76, height: 76, borderRadius: 10, borderWidth: 1, borderColor: border, alignItems: 'center', justifyContent: 'center' }}>
                                        <Ionicons name="images-outline" size={26} color={muted} />
                                    </Pressable>
                                </>
                            ) : null}
                        </View>
                    </View>
                );
            }
            case 'address': return (
                <View key={q.id}>
                    <TextBox {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} multiline maxLength={300} />
                    <Pressable onPress={() => setAddrFor(q.id)} style={{ flexDirection: 'row', alignItems: 'center', marginTop: -4, marginBottom: 12 }}>
                        <Ionicons name="location-outline" size={16} color={primary} style={{ marginRight: 6 }} />
                        <Text style={{ color: primary, fontWeight: '800' }}>{tr('Use a saved address')}</Text>
                    </Pressable>
                </View>
            );
            case 'longtext': return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} multiline maxLength={1000} />;
            default: return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} maxLength={200} />;
        }
    };

    const facts = [
        s.minGuests ? ['people-outline', tr('From {n} guests', { n: s.minGuests })] : null,
        s.noticeHours ? ['time-outline', tr('Ask {n} hours ahead', { n: s.noticeHours })] : null,
    ].filter(Boolean);
    const rest = (s.photos || []).filter(Boolean).slice(1);   // the first photo is the header; the others slide below

    return (
        <FormPage
            title={tr(s.name)}
            footer={(
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700' }}>{tr('Price')}</Text>
                        <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16 }}>{priceLine(s)}</Text>
                    </View>
                    <View style={{ width: s.paused ? 190 : 150 }}><Button label={s.paused ? tr('Temporarily unavailable') : tr('Inquire')} icon={s.paused ? 'pause-circle-outline' : 'send'} busy={busy} disabled={!!s.paused} onPress={send} /></View>
                </View>
            )}
        >
            {/* simple: the normal page bar with the name; a picture only when the owner added one, and a modest one */}
            {(s.photos || []).filter(Boolean)[0] ? <Image source={{ uri: (s.photos || []).filter(Boolean)[0] }} style={{ marginHorizontal: 16, marginTop: 4, height: 170, borderRadius: 16 }} contentFit="cover" transition={200} /> : null}

            {facts.length ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginTop: 16 }}>
                    {facts.map(([icon, label]) => (
                        <View key={label} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: primary + '1F', marginRight: 8, marginBottom: 8 }}>
                            <Ionicons name={icon} size={14} color={primary} style={{ marginRight: 6 }} />
                            <Text style={{ color: text, fontWeight: '700', fontSize: 12.5 }}>{label}</Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {s.description || (s.bullets || []).length ? (
                <View style={{ backgroundColor: surface, borderRadius: 20, borderWidth: 1, borderColor: border, padding: 16, marginHorizontal: 16, marginTop: facts.length ? 4 : 16, marginBottom: 6 }}>
                    {s.description ? <Text style={{ color: text, lineHeight: 21, fontSize: 14.5 }}>{tr(s.description)}</Text> : null}
                    {(s.bullets || []).length ? <Text style={{ color: text, fontWeight: '900', fontSize: 15, marginTop: s.description ? 14 : 0, marginBottom: 2 }}>{tr('What you get')}</Text> : null}
                    {(s.bullets || []).map((b) => (
                        <View key={b} style={{ flexDirection: 'row', marginTop: 8 }}>
                            <Ionicons name="checkmark-circle" size={18} color={primary} style={{ marginRight: 10, marginTop: 1 }} />
                            <Text style={{ color: text, flex: 1, lineHeight: 20 }}>{tr(b)}</Text>
                        </View>
                    ))}
                </View>
            ) : null}

            {rest.length ? (
                <View style={{ marginTop: 12 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, paddingHorizontal: 16, marginBottom: 2 }}>{tr('More photos')}</Text>
                    <PhotoCarousel photos={rest} />
                </View>
            ) : null}

            {s.paused ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 16, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: '#F59E0B', backgroundColor: '#FEF3C7' }}>
                    <Ionicons name="pause-circle" size={30} color="#B45309" style={{ marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                        <Text style={{ color: '#92400E', fontWeight: '900', fontSize: 15 }}>{tr('Temporarily unavailable')}</Text>
                        <Text style={{ color: '#92400E', marginTop: 3, lineHeight: 19 }}>{tr('Sorry, this service is temporarily unavailable.')} {tr('The shop is not taking new requests for now. Please check again later.')}</Text>
                    </View>
                </View>
            ) : null}
            <View style={{ height: 8 }} />
            <View pointerEvents={s.paused ? 'none' : 'auto'} style={{ opacity: s.paused ? 0.45 : 1 }}>
            <Group title={tr('Your details')}>
                <TextBox label={tr('Your name')} value={name} onChangeText={setName} maxLength={80} />
                <TextBox label={tr('Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} last />
            </Group>
            {asked.length ? (
                <Group title={tr('Tell us more')}>
                    {asked.map(field)}
                    {estimate ? <Text style={{ color: text, fontWeight: '800', marginBottom: 4 }}>{tr('About ₹{n} (estimate, the shop will confirm)', { n: estimate })}</Text> : null}
                </Group>
            ) : null}
            <Group title={tr('Your message')}>
                {s.quickTexts?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                        {s.quickTexts.map((t) => (
                            <Pressable key={t} onPress={() => setMessage(tr(t))} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                <Text style={{ color: text, fontSize: 13 }}>{tr(t)}</Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <TextBox label={tr('Message')} value={message} onChangeText={setMessage} multiline maxLength={1000} placeholder={tr('Tap a text above or write your own')} last />
            </Group>
            </View>
            <DateRangeSheet single ahead={365} visible={!!dateFor} value={answers[dateFor]} title={tr('Pick a day')} onClose={() => setDateFor('')} onApply={(d) => { set(dateFor, d || ''); setDateFor(''); }} />
            <AddressSheet visible={!!addrFor} onClose={() => setAddrFor('')} onSelect={(a) => { set(addrFor, addrLine(a).slice(0, 300)); setAddrFor(''); }} />
        </FormPage>
    );
}
