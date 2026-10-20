// Asks the customer for reviews at the right moments, and thanks him when he gives one.
//   - the order is delivered (the app is open): a sheet slides up at once to rate the DELIVERY
//   - the next time he opens the app: a sheet slides up to rate the FOOD of a delivered order he has not reviewed yet.
//     "Later" is always there; after one "later", or three days, the order is not asked about again
//   - any review given: a glowing "Thank you" note for a moment
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Modal, Pressable, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Sheet } from '../owners/ui';
import GlowBorder from '../common/GlowBorder';
import { DeliveryRatingCard } from '../common/feedback';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useThemeStore } from '../../store/common/useThemeStore';
import { onNotification } from '../../api/common/socket';
import { fetchOrders, fetchTracking, rateOrder } from '../../api/customers/shopApi';
import { showToast } from './shop';
import { tr } from '../../i18n';

const LATER_KEY = 'review.later.v1';
const MAX_LATER = 1;   // one "Later" and that order is never asked about again
const WINDOW_MS = 3 * 24 * 3600 * 1000;
const AWAY_MS = 20 * 60 * 1000;   // away from the app this long = "the next time he opens it"
const WORDS = ['Very bad', 'Bad', 'Okay', 'Good', 'Excellent'];
const askedThisOpen = new Set();   // orders already put in front of him since the app was opened

const readLater = async () => { try { return JSON.parse((await AsyncStorage.getItem(LATER_KEY)) || '{}'); } catch (e) { return {}; } };
const writeLater = async (m) => { try { await AsyncStorage.setItem(LATER_KEY, JSON.stringify(m)); } catch (e) { /* asked again next time */ } };

function Stars({ value, onChange, size = 38 }) {
    return (
        <View style={{ flexDirection: 'row', justifyContent: 'center', marginVertical: 6 }}>
            {[1, 2, 3, 4, 5].map((k) => (
                <Pressable key={k} onPress={() => onChange(k)} hitSlop={6}>
                    <Ionicons name={value >= k ? 'star' : 'star-outline'} size={size} color={value >= k ? '#F5A623' : '#BBBBBB'} style={{ marginHorizontal: 5 }} />
                </Pressable>
            ))}
        </View>
    );
}

// the dishes: one star rating and a few words for the whole order
function FoodForm({ order, onDone, onLater }) {
    const { primary, text, muted, border, background, radius } = useBrand();
    const [stars, setStars] = useState(0);
    const [comment, setComment] = useState('');
    const [busy, setBusy] = useState(false);
    const names = [...new Set((order.items || []).map((l) => l.name || l.title).filter(Boolean))];
    const submit = async () => {
        if (!stars || busy) return;
        setBusy(true);
        const c = comment.trim();
        const ids = [...new Set((order.items || []).map((l) => String(l.productId)))];
        try {
            await rateOrder(order.id || order._id, ids.map((productId) => ({ productId, rating: stars, ...(c ? { comment: c } : {}) })));
            onDone(stars);
        } catch (e) {
            showToast(e?.response?.data?.error || tr('Something went wrong'));
            if (e?.response?.status === 409) onDone(stars);
        } finally { setBusy(false); }
    };
    return (
        <View>
            <Text style={{ color: muted, textAlign: 'center', fontSize: 13, marginBottom: 4 }} numberOfLines={2}>
                {`#${order.orderNo} · ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`}
            </Text>
            <Stars value={stars} onChange={setStars} />
            <Text style={{ color: stars ? '#F5A623' : muted, textAlign: 'center', fontWeight: '800', marginBottom: 10 }}>{stars ? tr(WORDS[stars - 1]) : tr('Tap a star to rate')}</Text>
            {stars ? (
                <TextInput
                    value={comment} onChangeText={setComment} multiline maxLength={300}
                    placeholder={tr('Tell us what you liked (optional)')} placeholderTextColor={muted}
                    style={{ borderWidth: 1, borderColor: border, borderRadius: 12, padding: 12, minHeight: 70, color: text, backgroundColor: background, textAlignVertical: 'top', marginBottom: 10 }}
                />
            ) : null}
            <Pressable disabled={!stars || busy} onPress={submit} style={{ backgroundColor: primary, borderRadius: radius, paddingVertical: 14, alignItems: 'center', opacity: stars ? 1 : 0.5 }}>
                <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 15 }}>{busy ? '…' : tr('Submit review')}</Text>
            </Pressable>
            <Pressable onPress={onLater} hitSlop={8} style={{ alignItems: 'center', paddingVertical: 14 }}>
                <Text style={{ color: muted, fontWeight: '800' }}>{tr('Later')}</Text>
            </Pressable>
        </View>
    );
}

// a glowing thank-you for a moment
function ThankYou({ stars, onClose }) {
    const { surface, text, muted, primary } = useBrand();
    const shop = useThemeStore((s) => s.theme?.name) || '';
    useEffect(() => { const t = setTimeout(onClose, 3000); return () => clearTimeout(t); }, [onClose]);
    const glad = stars >= 4;
    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <Pressable onPress={onClose} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
                <GlowBorder active radius={26} width={3} colors={['#34D399', '#FBBF24', '#F472B6']} style={{ alignSelf: 'stretch' }}>
                    <View style={{ backgroundColor: surface, borderRadius: 26, padding: 26, alignItems: 'center' }}>
                        <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name={glad ? 'heart' : 'chatbubble-ellipses'} size={36} color={glad ? '#EF4444' : primary} />
                        </View>
                        <Text style={{ color: text, fontSize: 24, fontWeight: '900', marginTop: 14 }}>{tr('Thank you!')}</Text>
                        <Text style={{ color: muted, fontSize: 14.5, textAlign: 'center', marginTop: 8, lineHeight: 21 }}>
                            {glad
                                ? tr('So glad you enjoyed it. Your words make our day{shop}.', { shop: shop ? ` at ${shop}` : '' })
                                : tr('Thanks for telling us. We will work on it and make your next order better.')}
                        </Text>
                    </View>
                </GlowBorder>
            </Pressable>
        </Modal>
    );
}

export default function ReviewPrompts() {
    const user = useAuthStore((s) => s.user);
    const enabled = !!user && user.role !== 'rider' && user.role !== 'admin' && user.role !== 'superadmin';
    const [cur, setCur] = useState(null);       // { kind: 'delivery' | 'food', ... }
    const [thanks, setThanks] = useState(null); // stars
    const curRef = useRef(null);
    curRef.current = cur;
    const awayAt = useRef(0);

    // delivered just now: rate the delivery
    useEffect(() => {
        if (!enabled) return undefined;
        return onNotification((n) => {
            const d = n?.data || {};
            if (d.status !== 'delivered' || !d.orderId || curRef.current) return;
            setTimeout(async () => {
                try {
                    const t = await fetchTracking(d.orderId);
                    if (t?.canRate && !curRef.current) { askedThisOpen.add(String(d.orderId)); setCur({ kind: 'delivery', orderId: d.orderId, tracking: t }); }
                } catch (e) { /* the order page still has the rating card */ }
            }, 900);
        });
    }, [enabled]);

    // opened the app: rate the food of a delivered order
    const checkFood = useCallback(async () => {
        if (curRef.current) return;
        try {
            const [r, later] = await Promise.all([fetchOrders({ limit: 6 }), readLater()]);
            const now = Date.now();
            const o = (r.items || []).find((x) => {
                const id = String(x.id || x._id);
                const at = new Date(x.delivery?.deliveredAt || x.updatedAt || 0).getTime();
                return x.status === 'delivered' && x.orderType !== 'dine_in' && !x.ratedAt && now - at < WINDOW_MS && (later[id]?.n || 0) < MAX_LATER && !askedThisOpen.has(id);
            });
            if (o && !curRef.current) { askedThisOpen.add(String(o.id || o._id)); setCur({ kind: 'food', order: o }); }
        } catch (e) { /* asked again next time */ }
    }, []);

    useEffect(() => {
        if (!enabled) return undefined;
        const first = setTimeout(checkFood, 4000);
        const sub = AppState.addEventListener('change', (st) => {
            if (st !== 'active') { awayAt.current = Date.now(); return; }
            if (awayAt.current && Date.now() - awayAt.current > AWAY_MS) { askedThisOpen.clear(); setTimeout(checkFood, 2500); }
        });
        return () => { clearTimeout(first); sub.remove(); };
    }, [enabled, checkFood]);

    const later = async () => {
        const o = cur?.order || (cur?.orderId ? { id: cur.orderId } : null);
        setCur(null);
        if (!o) return;
        const id = String(o.id || o._id);
        const m = await readLater();
        m[id] = { n: (m[id]?.n || 0) + 1, at: Date.now() };
        writeLater(m);
    };
    const done = (stars) => { setCur(null); setThanks(stars || 5); };
    const closeThanks = useCallback(() => setThanks(null), []);

    if (!enabled) return null;
    return (
        <>
            <Sheet visible={!!cur} onClose={later} title={cur?.kind === 'food' ? tr('How was the food?') : tr('How was the delivery?')}>
                {cur?.kind === 'delivery' ? <DeliveryRatingCard bare orderId={cur.orderId} tracking={cur.tracking} onDone={done} /> : null}
                {cur?.kind === 'food' ? <FoodForm order={cur.order} onDone={done} onLater={later} /> : null}
            </Sheet>
            {thanks ? <ThankYou stars={thanks} onClose={closeThanks} /> : null}
        </>
    );
}
