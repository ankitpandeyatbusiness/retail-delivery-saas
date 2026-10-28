// The shop's "stay with us" discount (sent when it cancelled an order): the whole sentence, the code, and a clock that counts down the 30 minutes.
// useStayOffer() asks the server whether this guest has one alive and puts it in the coupon store, so the cart shows it first, with its clock, like any coupon.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { useCouponStore } from '../../store/customers/useCouponStore';
import { fetchStayOffer } from '../../api/customers/shopApi';
import { tr } from '../../i18n';

export function useStayOffer() {
    const [offer, setOffer] = useState(null);
    const load = useCallback(() => {
        fetchStayOffer().then((r) => {
            const o = r?.offer || null;
            setOffer(o);
            const st = useCouponStore.getState();
            if (o && st.offer?.code !== o.code) st.set(o.code, new Date(o.until).getTime(), { percent: o.percent, min: o.minOrder });
            else if (!o && st.offer) st.clear();   // used or run out
        }).catch(() => { });
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    return offer;
}

export default function StayOfferCard({ style }) {
    const { primary, text, muted } = useBrand();
    const offer = useStayOffer();
    const until = offer ? new Date(offer.until).getTime() : 0;
    const [now, setNow] = useState(Date.now());
    useEffect(() => { if (!until) return undefined; const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, [until]);
    const left = until ? Math.max(0, Math.round((until - now) / 1000)) : 0;
    if (!offer || left <= 0) return null;
    return (
        <View style={[{ marginHorizontal: 16, marginTop: 12, borderRadius: 16, padding: 14, backgroundColor: alpha(primary, 0.1), borderWidth: 1.5, borderColor: primary }, style]}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="gift" size={24} color={primary} />
                <Text style={{ color: primary, fontWeight: '900', fontSize: 16, marginLeft: 10, flex: 1 }}>{tr('{p}% off your next order', { p: offer.percent })}</Text>
                <Text style={{ color: primary, fontWeight: '900', fontSize: 18 }}>{`${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`}</Text>
            </View>
            <Text style={{ color: text, marginTop: 8, lineHeight: 20 }}>{offer.text}</Text>
            <Text style={{ color: muted, fontSize: 12.5, marginTop: 6 }}>{tr('The code is applied for you at checkout.')}</Text>
        </View>
    );
}
