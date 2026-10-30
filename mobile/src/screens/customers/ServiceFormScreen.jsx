// One service: photos, price and points on top, then the inquiry form (the shop owner chose the questions).
import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button, Empty } from '../../components/owners/ui';
import { FormPage, Group, TextBox, NumberBox, ChoiceBox, ToggleRow, DateBox, Label } from '../../components/owners/menuBits';
import { fetchService, sendInquiry } from '../../api/customers/shopApi';
import { FormShimmer } from '../../components/owners/shimmer';
import { showToast } from '../../components/customers/shop';
import { maskTime } from '../../utils/owners/menuRules';
import { priceLine } from '../owners/OwnerServicesScreen';
import { tr } from '../../i18n';

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

    useEffect(() => {
        fetchService(id).then((r) => { setS(r); setName(r.me?.name || ''); setPhone(r.me?.phone || ''); })
            .catch((e) => setErr(e?.response?.data?.error || tr('This service is not available')));
    }, [id]);

    if (!s) return <FormPage title={tr('Service')}>{err ? <Empty icon="alert-circle-outline" title={tr('Not available')} hint={err} /> : <FormShimmer />}</FormPage>;
    const set = (k, x) => setAnswers((a) => ({ ...a, [k]: x }));
    const asked = (s.questions || []).filter((q) => q.type !== 'photo');   // photo answers come in a later version
    const guests = Number(answers.guests ?? answers.plates ?? 0);
    const estimate = s.priceType === 'per_plate' && s.price > 0 && guests > 0 ? s.price * guests : 0;

    const send = async () => {
        if (!name.trim()) return showToast(tr('Please enter your name'));
        if (phone.replace(/\D/g, '').length < 6) return showToast(tr('Please enter your phone number'));
        for (const q of asked) {
            const v = answers[q.id];
            if (q.required && q.type !== 'yesno' && (v === undefined || v === '' || (Array.isArray(v) && !v.length))) return showToast(tr('Please answer: {q}', { q: q.label }));
        }
        setBusy(true);
        try {
            await sendInquiry(id, { name: name.trim(), phone: phone.trim(), message: message.trim(), answers });
            showToast(tr('Inquiry sent. The shop will reply here.'));
            nav.replace('MyInquiries');
        } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Try again.')); } finally { setBusy(false); }
    };

    const field = (q) => {
        const v = answers[q.id];
        const common = { label: q.label + (q.required ? ' *' : ''), hint: q.hint || undefined };
        switch (q.type) {
            case 'number': return <NumberBox key={q.id} {...common} value={v} onChange={(x) => set(q.id, x)} />;
            case 'date': return <DateBox key={q.id} {...common} value={v} onChange={(x) => set(q.id, x)} />;
            case 'time': return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, maskTime(x))} keyboardType="number-pad" placeholder="19:30" maxLength={5} />;
            case 'yesno': return <ToggleRow key={q.id} title={q.label} subtitle={q.hint || undefined} value={!!v} onValueChange={(x) => set(q.id, x)} />;
            case 'choice': return <ChoiceBox key={q.id} {...common} options={q.options.map((o) => [o, o])} value={v} onChange={(x) => set(q.id, x)} />;
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
                                        <Text style={{ color: on ? onPrimary : text, fontWeight: '800' }}>{o}</Text>
                                    </Pressable>
                                );
                            })}
                        </View>
                    </View>
                );
            }
            case 'phone': return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} keyboardType="phone-pad" maxLength={20} />;
            case 'longtext': case 'address': return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} multiline maxLength={q.type === 'address' ? 300 : 1000} />;
            default: return <TextBox key={q.id} {...common} value={v || ''} onChangeText={(x) => set(q.id, x)} maxLength={200} />;
        }
    };

    return (
        <FormPage title={s.name} footer={<Button label={tr('Inquire')} icon="send" busy={busy} onPress={send} />}>
            {s.photos?.length ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }}>
                    {s.photos.map((u) => <Image key={u} source={{ uri: u }} contentFit="cover" style={{ width: 260, height: 170, borderRadius: 14, marginRight: 10 }} />)}
                </ScrollView>
            ) : null}
            <View style={{ backgroundColor: surface, borderRadius: 14, borderWidth: 1, borderColor: border, padding: 14, marginBottom: 14 }}>
                <Text style={{ color: primary, fontWeight: '900', fontSize: 20 }}>{priceLine(s)}</Text>
                {s.description ? <Text style={{ color: text, marginTop: 8, lineHeight: 20 }}>{s.description}</Text> : null}
                {(s.bullets || []).map((b) => (
                    <View key={b} style={{ flexDirection: 'row', marginTop: 6 }}>
                        <Ionicons name="checkmark-circle" size={17} color={primary} style={{ marginRight: 8, marginTop: 1 }} />
                        <Text style={{ color: text, flex: 1 }}>{b}</Text>
                    </View>
                ))}
                {s.minGuests ? <Text style={{ color: muted, marginTop: 8, fontSize: 12 }}>{tr('At least {n} guests', { n: s.minGuests })}</Text> : null}
                {s.noticeHours ? <Text style={{ color: muted, marginTop: 2, fontSize: 12 }}>{tr('Please inquire {n} hours ahead', { n: s.noticeHours })}</Text> : null}
            </View>
            <Group title={tr('Your inquiry')}>
                <TextBox label={tr('Your name')} value={name} onChangeText={setName} maxLength={80} />
                <TextBox label={tr('Phone number')} value={phone} onChangeText={setPhone} keyboardType="phone-pad" maxLength={20} />
                {asked.map(field)}
                {estimate ? <Text style={{ color: text, fontWeight: '800', marginBottom: 12 }}>{tr('About ₹{n} (estimate, the shop will confirm)', { n: estimate })}</Text> : null}
                {s.quickTexts?.length ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 8 }}>
                        {s.quickTexts.map((t) => (
                            <Pressable key={t} onPress={() => setMessage(t)} style={{ marginRight: 8, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                                <Text style={{ color: text, fontSize: 13 }}>{t}</Text>
                            </Pressable>
                        ))}
                    </View>
                ) : null}
                <TextBox label={tr('Message')} value={message} onChangeText={setMessage} multiline maxLength={1000} placeholder={tr('Tap a text above or write your own')} last />
            </Group>
        </FormPage>
    );
}
