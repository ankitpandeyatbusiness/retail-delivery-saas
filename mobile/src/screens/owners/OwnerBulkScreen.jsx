// Bulk orders: the requests customers sent. A red dot is a request waiting for your quote. The rules (minimums, delivery fee, advance) are one tap away.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import useBulkLive from '../../hooks/common/useBulkLive';
import { Thumb } from '../customers/BulkOrderScreen';
import { ChatBadge } from '../../components/common/ChatButton';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Frame, Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import Masonry from '../../components/common/Masonry';
import { PageHeader, Card, Pill, Chips, Empty } from '../../components/owners/ui';
import { ToggleRow } from '../../components/owners/menuBits';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { bulk as api, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { BULK_STATUS, bulkTone, whenText } from '../customers/BulkOrderDetailScreen';
import { rs } from '../../components/customers/orders';
import { tr } from '../../i18n';

export default function OwnerBulkScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner with pause and the rules, status tabs, and the requests as cards in two columns
    const nav = useNavigation();
    const brand = useBrand();
    const { background, text, muted, primary, error } = brand;
    const [status, setStatus] = useState('requested');
    const [data, setData] = useState(null);
    const [err, setErr] = useState('');
    const [paused, setPaused] = useState(false);   // bulk ordering is temporarily stopped: customers still see it, marked unavailable

    const load = useCallback(async () => {
        api.settings().then((s) => setPaused(!!s.paused)).catch(() => { });
        try { setData(await api.list({ status: status || undefined })); setErr(''); }
        catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load the bulk orders.')); setData((x) => x || { items: [] }); }
    }, [status]);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useBulkLive(load);
    useEffect(() => onNotification((n) => { if (['bulk_new', 'bulk_change'].includes(String(n?.type))) load(); }), [load]);

    const pause = async (on) => {
        if (on && !(await ask({ title: tr('Pause bulk orders?'), message: tr('Customers still see Bulk order, marked "temporarily unavailable", and cannot send a new request. Orders already taken carry on.'), confirmText: tr('Pause'), cancelText: tr('Go back') }))) return;
        try { await api.saveSettings({ paused: on }); setPaused(on); showToast(on ? tr('Bulk orders are paused') : tr('Bulk orders are open again')); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Bulk orders')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <>
                        <Hero icon="cube" title={tr('Bulk orders')} subtitle={paused ? tr('Paused: customers see "temporarily unavailable".') : tr('Large orders: you send a quote, the customer pays an advance, you make it.')}
                            right={<>
                                <HeroBtn label={tr('Bulk order rules')} icon="settings-outline" onPress={() => nav.navigate('OwnerBulkSettings')} />
                                <HeroBtn label={paused ? tr('Open again') : tr('Pause')} icon={paused ? 'play-outline' : 'pause-outline'} solid onPress={() => pause(!paused)} />
                            </>}>
                            <View style={{ flexDirection: 'row', marginTop: 18 }}>
                                <GlassStat label={tr('Needs a quote')} value={data ? String(data.items.filter((o) => o.status === 'requested').length) : '–'} icon="alert-circle-outline" />
                                <GlassStat label={tr('Quote sent')} value={data ? String(data.items.filter((o) => o.status === 'quoted').length) : '–'} icon="paper-plane-outline" />
                                <GlassStat label={tr('Shown')} value={data ? String(data.items.length) : '–'} icon="list-outline" />
                            </View>
                        </Hero>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, marginBottom: 4 }}>
                            {[['', tr('All')], ['open', tr('Active')], ['requested', tr('Needs a quote')], ['quoted', tr('Quote sent')], ['delivered', tr('Delivered')], ['cancelled', tr('Cancelled')], ['paid', tr('Advance paid')]].map(([k, label]) => (
                                <Pressable key={k || 'all'} onPress={() => setStatus(k)} style={({ hovered }) => ({ paddingHorizontal: 16, height: 38, borderRadius: 19, marginRight: 8, marginBottom: 8, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', borderColor: status === k ? primary : hovered ? alpha(primary, 0.55) : alpha(muted, 0.3), backgroundColor: status === k ? primary : hovered ? alpha(primary, 0.07) : 'transparent', cursor: 'pointer' })}>
                                    <Text style={{ color: status === k ? '#FFFFFF' : text, fontWeight: '800', fontSize: 13.5 }}>{label}</Text>
                                </Pressable>
                            ))}
                        </View>
                    </>
                ) : null}
                {desk ? null : <Card tone={paused ? error : undefined}>
                    <ToggleRow title={tr('Pause bulk orders')} subtitle={paused ? tr('Paused: customers see "temporarily unavailable"') : tr('Stop new requests for a while. Orders already taken carry on.')} value={paused} onValueChange={pause} last />
                </Card>}
                {desk ? null : <Card onPress={() => nav.navigate('OwnerBulkSettings')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="settings-outline" size={20} color={primary} style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Bulk order rules')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Switch on, minimum order, notice time, delivery fee, advance')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </View>
                </Card>}
                {desk ? null : <View style={{ paddingHorizontal: 16 }}>
                    <Chips value={status} onChange={setStatus} options={[['', tr('All')], ['open', tr('Active')], ['requested', tr('Needs a quote')], ['quoted', tr('Quote sent')], ['delivered', tr('Delivered')], ['cancelled', tr('Cancelled')], ['paid', tr('Advance paid')]]} />
                </View>}
                {data === null ? <ListShimmer /> : null}
                {err && !data?.items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {data && !data.items.length && !err ? <Empty icon="cube-outline" title={tr('No bulk orders here')} hint={tr('When a customer asks for a large order, it appears here.')} /> : null}
                <Masonry desk={desk} gap={-16}>
                {(data?.items || []).map((o) => (
                    <Card key={o.id} onPress={() => nav.navigate('OwnerBulkOrder', { id: o.id })}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {o.status === 'requested' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: error, marginRight: 8 }} /> : null}
                            <Text numberOfLines={1} style={{ flex: 1, color: text, fontWeight: '900', fontSize: 16 }}>{o.contact?.company || o.contact?.name} · {o.code}</Text>
                            <ChatBadge kind="bulk" refId={o.id} />
                            <Pill label={tr(BULK_STATUS[o.status] || o.status)} color={bulkTone(o.status, brand)} />
                        </View>
                        <View style={{ flexDirection: 'row', marginTop: 8 }}>
                            {(o.lines || []).slice(0, 4).map((l, i) => <View key={`${l.productId}${i}`} style={{ marginRight: -8 }}><Thumb uri={l.image} size={36} /></View>)}
                            {(o.lines || []).length > 4 ? <Text style={{ color: muted, fontWeight: '800', alignSelf: 'center', marginLeft: 14 }}>+{o.lines.length - 4}</Text> : null}
                        </View>
                        <Text style={{ color: muted, marginTop: 6 }}>{o.fulfilment === 'delivery' ? tr('Delivery') : tr('Pickup')} · {whenText(o.when)}</Text>
                        <Text style={{ color: text, marginTop: 4 }}>{o.lines.reduce((n, l) => n + l.quantity, 0)} {tr('pieces')} · {rs(o.quote?.pricing?.total ?? o.pricing?.total)}</Text>
                    </Card>
                ))}
                </Masonry>
              </Frame>
            </ScrollView>
        </View>
    );
}
