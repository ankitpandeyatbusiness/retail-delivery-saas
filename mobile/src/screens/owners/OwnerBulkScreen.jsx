// Bulk orders: the requests customers sent. A red dot is a request waiting for your quote. The rules (minimums, delivery fee, advance) are one tap away.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import useBulkLive from '../../hooks/common/useBulkLive';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
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
                <Card tone={paused ? error : undefined}>
                    <ToggleRow title={tr('Pause bulk orders')} subtitle={paused ? tr('Paused: customers see "temporarily unavailable"') : tr('Stop new requests for a while. Orders already taken carry on.')} value={paused} onValueChange={pause} last />
                </Card>
                <Card onPress={() => nav.navigate('OwnerBulkSettings')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="settings-outline" size={20} color={primary} style={{ marginRight: 12 }} />
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Bulk order rules')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Switch on, minimum order, notice time, delivery fee, advance')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </View>
                </Card>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips value={status} onChange={setStatus} options={[['', tr('All')], ['open', tr('Active')], ['requested', tr('Needs a quote')], ['quoted', tr('Quote sent')], ['delivered', tr('Delivered')], ['cancelled', tr('Cancelled')], ['paid', tr('Advance paid')]]} />
                </View>
                {data === null ? <ListShimmer /> : null}
                {err && !data?.items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {data && !data.items.length && !err ? <Empty icon="cube-outline" title={tr('No bulk orders here')} hint={tr('When a customer asks for a large order, it appears here.')} /> : null}
                {(data?.items || []).map((o) => (
                    <Card key={o.id} onPress={() => nav.navigate('OwnerBulkOrder', { id: o.id })}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            {o.status === 'requested' ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: error, marginRight: 8 }} /> : null}
                            <Text numberOfLines={1} style={{ flex: 1, color: text, fontWeight: '900', fontSize: 16 }}>{o.contact?.company || o.contact?.name} · {o.code}</Text>
                            <Pill label={tr(BULK_STATUS[o.status] || o.status)} color={bulkTone(o.status, brand)} />
                        </View>
                        <Text style={{ color: muted, marginTop: 4 }}>{o.fulfilment === 'delivery' ? tr('Delivery') : tr('Pickup')} · {whenText(o.when)}</Text>
                        <Text style={{ color: text, marginTop: 4 }}>{o.lines.reduce((n, l) => n + l.quantity, 0)} {tr('pieces')} · {rs(o.quote?.pricing?.total ?? o.pricing?.total)}</Text>
                    </Card>
                ))}
            </ScrollView>
        </View>
    );
}
