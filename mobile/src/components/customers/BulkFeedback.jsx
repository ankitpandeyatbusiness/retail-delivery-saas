// After a bulk order is delivered: rate the food, rate the delivery (a delivery order) and send a complaint. It all runs on the order's hidden work ticket
// (`ticketId`), so it is the same rating, points and complaint flow as any order.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../common/kit';
import { Card, Button } from '../owners/ui';
import { DeliveryRatingCard, ComplaintCard } from '../common/feedback';
import { showToast } from './shop';
import { fetchOrder, rateOrder, fetchRatings, fetchTracking } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

const errMsg = (e) => e?.response?.data?.error || e?.message || 'Something went wrong';
const WORDS = ['Very bad', 'Bad', 'Okay', 'Good', 'Excellent'];

function FoodRating({ ticketId }) {
    const { primary, text, muted, border } = useBrand();
    const [items, setItems] = useState(null);
    const [saved, setSaved] = useState(null);
    const [editing, setEditing] = useState(false);
    const [stars, setStars] = useState(0);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        fetchOrder(ticketId).then((o) => setItems(o.items || [])).catch(() => { });
        fetchRatings(ticketId).then((r) => {
            const L = r.items || [];
            if (L.length) setSaved({ stars: Math.round(L.reduce((a, x) => a + x.rating, 0) / L.length), comment: L.find((x) => x.comment)?.comment || '' });
        }).catch(() => { });
    }, [ticketId]);
    if (!items) return null;
    const showForm = !saved || editing;
    const submit = async () => {
        if (!stars || busy) return;
        setBusy(true);
        const c = comment.trim();
        const ids = [...new Set(items.map((l) => String(l.productId)))];
        try {
            await rateOrder(ticketId, ids.map((productId) => ({ productId, rating: stars, ...(c ? { comment: c } : {}) })));
            showToast(saved ? tr('Review updated') : tr('Thanks for your review'));
            setSaved({ stars, comment: c }); setEditing(false);
        } catch (e) { showToast(errMsg(e)); } finally { setBusy(false); }
    };
    const row = (n, onPress) => (
        <View style={{ flexDirection: 'row', marginVertical: 8 }}>
            {[1, 2, 3, 4, 5].map((k) => (
                <Pressable key={k} disabled={!onPress} onPress={() => onPress(k)} hitSlop={6} style={{ marginRight: 8 }}>
                    <Ionicons name={n >= k ? 'star' : 'star-outline'} size={n === stars && onPress ? 36 : 32} color={n >= k ? '#F5A623' : '#BBBBBB'} />
                </Pressable>
            ))}
        </View>
    );
    return (
        <Card>
            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{showForm ? (editing ? tr('Edit your review') : tr('Rate this order')) : tr('Your review')}</Text>
            {showForm ? (
                <>
                    {row(stars, setStars)}
                    <Text style={{ color: stars ? '#F5A623' : muted, fontWeight: '800' }}>{stars ? tr(WORDS[stars - 1]) : tr('Tap a star to rate')}</Text>
                    <TextInput value={comment} onChangeText={setComment} multiline maxLength={300} placeholder={tr('Tell us how it was (optional)')} placeholderTextColor={muted}
                        style={{ color: text, borderWidth: 1, borderColor: border, borderRadius: 12, padding: 10, minHeight: 70, marginTop: 10, textAlignVertical: 'top' }} />
                    <Button label={saved ? tr('Update review') : tr('Submit review')} busy={busy} disabled={!stars} onPress={submit} style={{ marginTop: 10 }} />
                </>
            ) : (
                <>
                    {row(saved.stars)}
                    {saved.comment ? <Text style={{ color: text }}>{saved.comment}</Text> : null}
                    <Pressable onPress={() => { setStars(saved.stars); setComment(saved.comment); setEditing(true); }} style={{ marginTop: 8 }}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Edit your review')}</Text></Pressable>
                </>
            )}
        </Card>
    );
}

export default function BulkFeedback({ ticketId, delivery }) {
    const [track, setTrack] = useState(null);
    const get = useCallback(() => { if (delivery) fetchTracking(ticketId).then(setTrack).catch(() => { }); }, [ticketId, delivery]);
    useEffect(() => { get(); }, [get]);
    return (
        <View style={{ paddingHorizontal: 16, marginTop: 4 }}>
            <FoodRating ticketId={ticketId} />
            {delivery && track ? <DeliveryRatingCard orderId={ticketId} tracking={track} onDone={get} /> : null}
            <ComplaintCard orderId={ticketId} />
        </View>
    );
}
