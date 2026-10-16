// Home: the shop's control room. Phase 0 shows the live numbers the server already has (/shop/live) and the
// Soundbox status, so the owner panel is usable and the alert can be tested. The full dashboard arrives in Phase 1.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Stat, Row, Button, Pill, money } from '../../components/owners/ui';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { useSoundboxStore } from '../../store/owners/useSoundboxStore';
import { useAlertStore } from '../../store/owners/useAlertStore';
import { onOrderUpdate } from '../../api/common/socket';
import { clearAll } from '../../utils/owners/soundbox';

const PIPELINE = [
    ['placed', 'New', 'flash'],
    ['accepted', 'Accepted', 'checkmark-circle'],
    ['preparing', 'Cooking', 'flame'],
    ['ready', 'Ready', 'restaurant'],
    ['out_for_delivery', 'On the road', 'bicycle'],
];

export default function OwnerHomeScreen() {
    const nav = useNavigation();
    const { muted, primary, error } = useBrand();
    const live = useOwnerStore((st) => st.live);
    const loadError = useOwnerStore((st) => st.error);
    const refresh = useOwnerStore((st) => st.refresh);
    const soundbox = useSoundboxStore((st) => st.soundbox);
    const ringing = useAlertStore((a) => a.ringing);
    const [refreshing, setRefreshing] = useState(false);

    useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
    // an order changed anywhere: update the numbers
    useEffect(() => onOrderUpdate(() => { refresh(); }), [refresh]);

    const pull = async () => { setRefreshing(true); await refresh(); setRefreshing(false); };
    const active = live?.orders?.active || {};
    const riders = live?.riders || [];
    const online = riders.filter((r) => r.isOnline).length;

    return (
        <OwnerScreen onRefresh={pull} refreshing={refreshing}>
            {loadError && !live ? (
                <Card tone={error}><Text style={{ color: error, fontWeight: '700' }}>{loadError}</Text></Card>
            ) : null}

            {/* a real order is ringing: one tap silences it (opening the order does the same) */}
            {ringing ? (
                <Card tone={error}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="notifications" size={22} color={error} />
                        <Text style={{ color: error, fontWeight: '900', flex: 1, marginLeft: 10 }}>A new order is waiting</Text>
                        <Button label="Silence" icon="volume-mute" kind="danger" onPress={clearAll} />
                    </View>
                </Card>
            ) : null}

            <SectionTitle title="Today" />
            <Card>
                <View style={{ flexDirection: 'row' }}>
                    <Stat label="Sales so far" value={money(live?.revenueToday)} color={primary} />
                    <Stat label="Orders in progress" value={String(live?.orders?.activeTotal ?? '–')} />
                </View>
            </Card>

            <SectionTitle title="Order pipeline" action="Open orders" onAction={() => nav.navigate('OrdersTab')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10 }}>
                {PIPELINE.map(([key, label, icon]) => (
                    <Card key={key} onPress={() => nav.navigate('OrdersTab')} style={{ width: '29%', marginHorizontal: '2%', alignItems: 'center', paddingVertical: 12 }}>
                        <Ionicons name={icon} size={20} color={active[key] ? primary : muted} />
                        <Text style={{ fontSize: 22, fontWeight: '900', color: active[key] ? primary : muted, marginTop: 2 }}>{active[key] || 0}</Text>
                        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={{ fontSize: 11, color: muted, fontWeight: '700', maxWidth: '100%' }}>{label}</Text>
                    </Card>
                ))}
            </View>

            <SectionTitle title="Delivery" />
            <Card>
                <Row icon="bicycle" title="Riders" subtitle={riders.length ? `${online} online · ${riders.length} on duty` : 'No rider is online'} onPress={() => nav.navigate('RidersTab')} last />
            </Card>

            <SectionTitle title="Alerts" />
            <Card>
                <Row
                    icon="volume-high"
                    title="Soundbox"
                    subtitle={soundbox ? 'ON: new orders are read out loud, even with the screen off' : 'OFF: no sound for new orders on this phone'}
                    right={<Pill label={soundbox ? 'ON' : 'OFF'} color={soundbox ? undefined : muted} />}
                    onPress={() => nav.navigate('Soundbox')}
                    last
                />
            </Card>

            {live?.openComplaints ? (
                <Card onPress={() => nav.navigate('ShopHub')}>
                    <Row icon="chatbubble-ellipses" title={`${live.openComplaints} open complaint${live.openComplaints === 1 ? '' : 's'}`} subtitle="Customers are waiting for a reply" last />
                </Card>
            ) : null}
        </OwnerScreen>
    );
}
