// The popup for a new order, on top of whatever the rider is doing: what he earns, how far, what to collect, and Accept / No thanks
// (no map here: the map opens after he accepts). It opens by itself when the server offers an order (event "rider:offer").
import React, { useEffect, useState } from 'react';
import { Modal, View, Text, Vibration, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../common/kit';
import { showToast } from '../customers/shop';
import { onRiderOffer } from '../../api/common/socket';
import { playSfx } from '../../utils/common/sfx';
import { acceptOrder, rejectOrder } from '../../api/riders/riderApi';
import { useRiderStore } from '../../store/riders/useRiderStore';
import { T, rupee, rupeeAmount, errText } from '../../utils/riders/riderText';
import { tr } from '../../i18n';
import { BigButton, SmallLink, Banner } from './riderBits';

const secondsLeft = (o) => {
    const t = o?.delivery?.offerExpiresAt;
    return t ? Math.max(0, Math.round((new Date(t).getTime() - Date.now()) / 1000)) : null;
};

export default function OfferPopup() {
    const insets = useSafeAreaInsets();
    const nav = useNavigation();
    const { primary, background, text, muted } = useBrand();
    const offers = useRiderStore((s) => s.offers);
    const [id, setId] = useState(null);
    const [busy, setBusy] = useState(false);
    const [, tick] = useState(0);

    useEffect(() => onRiderOffer(async (card) => {
        Vibration.vibrate([0, 500, 250, 500]);
        await useRiderStore.getState().load();
        const hit = useRiderStore.getState().offers.find((x) => String(x.id) === String(card?.orderId));
        if (hit) setId(String(hit.id));
    }), []);

    useEffect(() => {
        if (!id) return undefined;
        const t = setInterval(() => tick((n) => n + 1), 1000);
        return () => clearInterval(t);
    }, [id]);

    const o = id ? offers.find((x) => String(x.id) === id) : null;
    const left = o ? secondsLeft(o) : null;
    const open = !!o && left !== 0;
    useEffect(() => { if (id && !open) setId(null); }, [id, open]);   // taken by someone else, or the time ran out: it goes away by itself
    if (!open) return null;

    const cash = o.payment?.collectAmount > 0;
    const accept = async () => {
        setBusy(true);
        try {
            await acceptOrder(o.id);
            playSfx('riderAccept');
            await useRiderStore.getState().load();
            setId(null);
            nav.navigate('RiderTrip', { orderId: String(o.id) });
        } catch (e) {
            showToast(e?.response?.status === 409 ? T.taken : errText(e));
            useRiderStore.getState().load();
        }
        setBusy(false);
    };
    const reject = async () => {
        setId(null);
        try { await rejectOrder(o.id); playSfx('riderReject'); } catch (e) { showToast(errText(e)); }
        useRiderStore.getState().load();
    };

    return (
        <Modal visible transparent animationType="slide" onRequestClose={() => setId(null)} statusBarTranslucent>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
                <View style={{ backgroundColor: background, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '92%', paddingBottom: insets.bottom + 12 }}>
                    <ScrollView contentContainerStyle={{ padding: 16 }} bounces={false}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ color: primary, fontWeight: '900', fontSize: 17 }}>{T.newOrder} · #{o.orderNo}</Text>
                            {left != null ? <Text style={{ color: left <= 10 ? '#DC2626' : muted, fontWeight: '900', fontSize: 15 }}>{T.secondsLeft(left)}</Text> : null}
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 14 }}>
                            {o.earnPaise > 0 ? (
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{T.youEarn('')}</Text>
                                    <Text style={{ color: text, fontSize: 32, fontWeight: '900' }}>{rupee(o.earnPaise)}</Text>
                                </View>
                            ) : null}
                            {o.distanceKm != null ? (
                                <View style={{ flex: 1, alignItems: o.earnPaise > 0 ? 'flex-end' : 'flex-start' }}>
                                    <Text style={{ color: text, fontSize: 24, fontWeight: '900' }}>{tr('{distanceKm} km', { distanceKm: o.distanceKm })}</Text>
                                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('shop to customer')}</Text>
                                </View>
                            ) : null}
                        </View>
                        <Text style={{ color: muted, fontSize: 13, fontWeight: '600', marginTop: 10 }} numberOfLines={1}>
                            {[o.address?.landmark, o.address?.city].filter(Boolean).join(', ') || ''}
                        </Text>
                        <View style={{ marginTop: 10 }}>
                            <Banner tone={cash ? 'warn' : 'ok'} style={{ marginHorizontal: 0, marginBottom: 0 }} text={cash ? T.collectCash(rupeeAmount(o.payment.collectAmount)) : T.paidOnline} />
                        </View>
                        <View style={{ marginTop: 14 }}>
                            <BigButton label={T.accept} icon="checkmark" onPress={accept} busy={busy} />
                        </View>
                        <SmallLink label={T.noThanks} onPress={reject} />
                    </ScrollView>
                </View>
            </View>
        </Modal>
    );
}
