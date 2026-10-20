// After he has paid, once: "How was your meal?". The answer goes to the OWNER only. A happy guest is then invited to rate the dishes
// (that is the public rating); an unhappy one is never pushed to a public rating. "Skip" means never ask again for that visit.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Button, Sheet } from '../owners/ui';
import { Chip } from './cartParts';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { sendTableFeedback } from '../../api/customers/shopApi';
import { showToast } from './shop';
import { tr } from '../../i18n';

const KEY = 'tablefb.skipped.v1';
const TAGS = ['Food', 'Service', 'Waiting time', 'Cleanliness', 'Price', 'Other'];
const WORDS = ['Very bad', 'Bad', 'Okay', 'Good', 'Excellent'];

export default function TableFeedbackHost({ navRef }) {
    const { text, muted, border, surface, primary, ok } = useBrand();
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && ['rider', 'admin', 'kitchen', 'waiter'].indexOf(user.role) < 0;
    const due = useTableBill((s) => s.bill?.feedbackDue);
    const [skipped, setSkipped] = useState(null);   // null = not read yet
    const [ready, setReady] = useState(false);
    const [stars, setStars] = useState(0);
    const [tags, setTags] = useState([]);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const [sent, setSent] = useState(false);
    useEffect(() => { AsyncStorage.getItem(KEY).then((v) => setSkipped(JSON.parse(v || '[]'))).catch(() => setSkipped([])); }, []);
    // not the moment he pays: a few seconds later
    useEffect(() => {
        setStars(0); setTags([]); setComment(''); setSent(false); setReady(false);
        if (!due) return undefined;
        const t = setTimeout(() => setReady(true), 3500);
        return () => clearTimeout(t);
    }, [due?.sessionId]);   // eslint-disable-line react-hooks/exhaustive-deps

    const forget = async () => {
        const next = [...(skipped || []), due.sessionId].slice(-30);
        setSkipped(next);
        try { await AsyncStorage.setItem(KEY, JSON.stringify(next)); } catch (e) { /* asked again next time */ }
    };
    const show = enabled && !!due && ready && skipped !== null && !skipped.includes(due.sessionId);
    const send = async () => {
        setBusy(true);
        try { await sendTableFeedback({ sessionId: due.sessionId, stars, tags, comment: comment.trim() }); setSent(true); } catch (e) { showToast(e?.response?.data?.error || tr('Could not send. Please try again.')); } finally { setBusy(false); }
    };
    const close = async () => { await forget(); useTableBill.getState().load(); };

    return (
        <Sheet visible={show} onClose={close} title={sent ? tr('Thank you') : tr('How was your meal?')}>
            {show ? (sent ? (
                <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                    <Ionicons name="heart" size={44} color={ok} />
                    <Text style={{ color: text, fontWeight: '800', textAlign: 'center', marginTop: 10 }}>{stars >= 4 ? tr('We are glad you enjoyed it. Would you also rate the dishes? It helps other guests.') : tr('Thank you for telling us. The owner will read it.')}</Text>
                    {stars >= 4 && due.orderId ? <Button label={tr('Rate the dishes')} icon="star" onPress={async () => { await close(); if (navRef?.isReady?.()) navRef.navigate('OrderDetail', { id: due.orderId }); }} style={{ alignSelf: 'stretch', marginTop: 14 }} /> : null}
                    <Pressable onPress={close} hitSlop={8} style={{ paddingTop: 14 }}><Text style={{ color: muted, fontWeight: '800' }}>{tr('Close')}</Text></Pressable>
                </View>
            ) : (
                <View>
                    <Text style={{ color: muted, textAlign: 'center', marginBottom: 10 }}>{tr('Table {t}. What you write here goes only to the owner.', { t: due.table })}</Text>
                    <View style={{ flexDirection: 'row', justifyContent: 'center' }}>
                        {[1, 2, 3, 4, 5].map((n) => (
                            <Pressable key={n} onPress={() => setStars(n)} hitSlop={6} style={{ paddingHorizontal: 6 }}>
                                <Ionicons name={n <= stars ? 'star' : 'star-outline'} size={38} color={n <= stars ? '#F5B301' : muted} />
                            </Pressable>
                        ))}
                    </View>
                    {stars ? <Text style={{ color: text, fontWeight: '900', textAlign: 'center', marginTop: 6 }}>{tr(WORDS[stars - 1])}</Text> : null}
                    {stars && stars <= 3 ? (
                        <View style={{ marginTop: 12 }}>
                            <Text style={{ color: text, fontWeight: '800', marginBottom: 6 }}>{tr('Sorry about that. What went wrong?')}</Text>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                {TAGS.map((tg) => <Chip key={tg} label={tr(tg)} on={tags.includes(tg)} onPress={() => setTags((p) => (p.includes(tg) ? p.filter((x) => x !== tg) : [...p, tg]))} />)}
                            </View>
                        </View>
                    ) : null}
                    {stars ? (
                        <TextInput value={comment} onChangeText={setComment} maxLength={300} multiline placeholder={tr('Anything else? (optional)')} placeholderTextColor={muted}
                            style={{ marginTop: 10, borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 12, padding: 12, minHeight: 60, maxHeight: 110 }} />
                    ) : null}
                    <Button label={tr('Send to the owner')} icon="send" busy={busy} disabled={!stars} onPress={send} style={{ marginTop: 12 }} />
                    <Pressable onPress={close} hitSlop={8} style={{ alignItems: 'center', paddingTop: 14 }}><Text style={{ color: muted, fontWeight: '800' }}>{tr('Skip')}</Text></Pressable>
                </View>
            )) : null}
        </Sheet>
    );
}
