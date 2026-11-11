// On Home, in dine in mode: how long food usually takes, the offers he can get at the table, and "Order your usual".
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { useAuthStore } from '../../store/common/useAuthStore';
import { fetchDineStatus, fetchDineOffers, fetchDineUsual } from '../../api/customers/shopApi';
import { reorder } from './orders';
import { tr } from '../../i18n';
import { useCustomerDesktop } from '../../utils/common/layout';

export default function DineHomeCard() {
    const nav = useNavigation();
    const desk = useCustomerDesktop();   // the desktop website: a wide card with the pieces side by side (false in the phone app)
    const { surface, text, muted, border, primary, ok } = useBrand();
    const user = useAuthStore((s) => s.user);
    const [st, setSt] = useState(null);
    const [offers, setOffers] = useState([]);
    const [usual, setUsual] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        let alive = true;
        const load = () => {
            fetchDineStatus().then((r) => { if (alive) setSt(r); }).catch(() => { });
            if (user) {
                fetchDineOffers().then((r) => { if (alive) setOffers(r.items || []); }).catch(() => { });
                fetchDineUsual().then((r) => { if (alive) setUsual(r.usual || null); }).catch(() => { });
            }
        };
        load();
        const t = setInterval(load, 60000);
        return () => { alive = false; clearInterval(t); };
    }, [user?.id || user?._id]);   // eslint-disable-line react-hooks/exhaustive-deps
    if (!st?.waitMin && !offers.length && !usual) return null;
    if (desk) {
        return (
            <View style={{ flexDirection: 'row', alignItems: 'stretch', flexWrap: 'wrap', gap: 16, marginTop: 12, padding: 20, borderRadius: 24, backgroundColor: surface, borderWidth: 1, borderColor: border, boxShadow: `0 8px 28px ${primary}14` }}>
                {st?.waitMin ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 20, borderRightWidth: offers.length || usual ? 1 : 0, borderRightColor: border }}>
                        <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                            <Ionicons name="time" size={26} color={primary} />
                        </View>
                        <View style={{ marginLeft: 14 }}>
                            <Text style={{ color: text, fontSize: 26, fontWeight: '900', letterSpacing: -0.5 }}>{tr('{n} min', { n: st.waitMin })}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, fontWeight: '600' }}>{tr('Usually ready in about {n} min', { n: st.waitMin })}</Text>
                        </View>
                    </View>
                ) : null}
                {offers.length ? (
                    <View style={{ flex: 1, minWidth: 240, justifyContent: 'center' }}>
                        {offers.map((o, i) => (
                            <View key={o.kind} style={{ flexDirection: 'row', alignItems: 'center', marginTop: i ? 8 : 0 }}>
                                <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: alpha(ok, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="pricetag" size={15} color={ok} /></View>
                                <Text style={{ color: text, fontSize: 14.5, fontWeight: o.on ? '900' : '700', marginLeft: 10, flex: 1 }}>{tr(o.text)}</Text>
                            </View>
                        ))}
                    </View>
                ) : <View style={{ flex: 1 }} />}
                {usual ? (
                    <Pressable
                        onPress={() => reorder({ id: usual.id, items: [] }, nav, setBusy)}
                        accessibilityRole="button"
                        style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', minWidth: 280, maxWidth: 360, paddingVertical: 12, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: primary, backgroundColor: hovered ? alpha(primary, 0.2) : alpha(primary, 0.1), cursor: 'pointer', boxShadow: hovered ? `0 8px 20px ${primary}33` : '0 0 0 rgba(0,0,0,0)', transform: [{ translateY: hovered ? -2 : 0 }], transitionProperty: 'background-color, box-shadow, transform', transitionDuration: '180ms' })}
                    >
                        <Ionicons name="repeat" size={24} color={primary} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: primary, fontSize: 15, fontWeight: '900' }}>{tr('Order your usual')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }} numberOfLines={1}>{usual.brief}</Text>
                        </View>
                        {busy ? <ActivityIndicator size="small" color={primary} /> : <Ionicons name="arrow-forward" size={19} color={primary} />}
                    </Pressable>
                ) : null}
            </View>
        );
    }
    return (
        <View style={{ marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 18, backgroundColor: surface, borderWidth: 1, borderColor: border }}>
            {st?.waitMin ? (
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="time-outline" size={18} color={muted} />
                    <Text style={{ color: text, fontWeight: '700', marginLeft: 8, flex: 1 }}>{tr('Usually ready in about {n} min', { n: st.waitMin })}</Text>
                </View>
            ) : null}
            {offers.map((o) => (
                <View key={o.kind} style={{ flexDirection: 'row', alignItems: 'center', marginTop: st?.waitMin || o !== offers[0] ? 8 : 0 }}>
                    <Ionicons name="pricetag" size={18} color={ok} />
                    <Text style={{ color: text, fontWeight: o.on ? '900' : '700', marginLeft: 8, flex: 1 }}>{tr(o.text)}</Text>
                </View>
            ))}
            {usual ? (
                <Pressable onPress={() => reorder({ id: usual.id, items: [] }, nav, setBusy)} style={{ marginTop: st?.waitMin || offers.length ? 12 : 0, flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 14, backgroundColor: alpha(primary, 0.12) }}>
                    <Ionicons name="repeat" size={20} color={primary} />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={{ color: primary, fontWeight: '900' }}>{tr('Order your usual')}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }} numberOfLines={1}>{usual.brief}</Text>
                    </View>
                    {busy ? <ActivityIndicator size="small" color={primary} /> : <Ionicons name="chevron-forward" size={18} color={primary} />}
                </Pressable>
            ) : null}
        </View>
    );
}
