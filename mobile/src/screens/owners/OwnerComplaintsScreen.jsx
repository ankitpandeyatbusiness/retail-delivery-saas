// Complaints from customers: New / In progress / Decided. Tap one to read it and answer.
import React, { useCallback, useState } from 'react';
import { FilterBar } from '../../components/owners/FilterPopup';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Pill, Empty } from '../../components/owners/ui';
import { fetchComplaints, apiError } from '../../api/owners/shopApi';
import { onNotification } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { COMPLAINT_TYPES, COMPLAINT_STATUS, RESOLUTION_TEXT } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { ListShimmer } from '../../components/owners/shimmer';
import GlowBorder from '../../components/common/GlowBorder';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Hero, GlassStat } from '../../components/owners/RiderDesk';
import { Ionicons } from '@expo/vector-icons';
import { tr } from '../../i18n';

const TYPE_ICON = { missing_item: 'remove-circle', wrong_item: 'swap-horizontal', quality: 'restaurant', late: 'time', packaging: 'cube', other: 'chatbubble-ellipses', not_received: 'close-circle' };

export default function OwnerComplaintsScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, tabs for the three stages and the complaints as cards two across
    const gcols = useGridCols(2, 420);   // fewer, wider cards in a narrow window
    const nav = useNavigation();
    const { background, text, muted, error, ok, primary } = useBrand();
    const [status, setStatus] = useState('open');
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [fetching, setFetching] = useState(false);   // a computer keeps the list on screen, a little dimmed, while the other stage loads

    const load = useCallback(async (p = 1, st = status) => {
        setFetching(true);
        try {
            const r = await fetchComplaints({ status: st, page: p });
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load complaints.')); setItems((x) => x || []); } finally { setFetching(false); }
    }, [status]);

    useFocusEffect(useCallback(() => {
        load(1);
        return onNotification((n) => { if (['complaint_new', 'complaint_reminder'].includes(String(n?.type))) load(1); });   // a new complaint shows at once
    }, [load]));
    const pick = (s) => { setStatus(s); if (!desk) setItems(null); };

    const deskHeader = (
        <View style={{ paddingBottom: 8 }}>
            <Hero icon="chatbubble-ellipses" title={tr('Complaints')} subtitle={tr('Read what the customer wrote, then answer: a reply, a refund or no refund.')}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 18 }}>
                    {Object.entries(COMPLAINT_STATUS).map(([k, label]) => (
                        <Pressable key={k} onPress={() => pick(k)} style={({ hovered }) => ({ paddingHorizontal: 18, height: 42, borderRadius: 21, marginRight: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: status === k ? '#FFFFFF' : hovered ? 'rgba(255,255,255,0.34)' : 'rgba(255,255,255,0.2)', cursor: 'pointer' })}>
                            <Text style={{ color: status === k ? primary : '#FFFFFF', fontWeight: '900', fontSize: 14 }}>{tr(label)}</Text>
                        </Pressable>
                    ))}
                    <View style={{ flex: 1 }} />
                    <GlassStat compact label={tr(COMPLAINT_STATUS[status] || 'All')} value={items ? String(items.length) + (more ? '+' : '') : '–'} icon="list-outline" />
                </View>
            </Hero>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Complaints')} />
            <View style={desk ? { flex: 1, width: '100%', maxWidth: 1240, alignSelf: 'center', opacity: fetching ? 0.55 : 1, transitionProperty: 'opacity', transitionDuration: '160ms' } : { flex: 1 }}>
            <FlatList
                key={desk ? `g${gcols}` : 'g1'}
                numColumns={desk ? gcols : 1}
                data={items || []}
                keyExtractor={(c) => String(c.id)}
                contentContainerStyle={{ paddingBottom: 32 }}
                ListHeaderComponent={desk ? deskHeader : <FilterBar title={tr('Filter complaints')} summary={tr(COMPLAINT_STATUS[status] || 'All')} activeCount={0} style={{ paddingBottom: 16 }} sections={[{ key: 'status', title: 'Status', options: Object.entries(COMPLAINT_STATUS), value: status, onChange: pick }]} />}
                renderItem={({ item: c }) => desk ? (
                    <View style={{ width: `${100 / gcols}%`, padding: 8 }}>
                        <GlowBorder active={c.status !== 'resolved'} radius={22}>
                            <Pressable onPress={() => nav.navigate('OwnerComplaint', { complaint: c })} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : muted + '33', backgroundColor: hovered ? primary + '0D' : background, padding: 18, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: (c.status === 'resolved' ? ok : error) + '24', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={TYPE_ICON[c.type] || 'alert-circle'} size={22} color={c.status === 'resolved' ? ok : error} /></View>
                                    <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                        <Text style={{ color: text, fontWeight: '900', fontSize: 16 }} numberOfLines={1}>{tr(COMPLAINT_TYPES[c.type] || c.type)}</Text>
                                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }} numberOfLines={1}>{c.bulkCode ? tr('Bulk order {c}', { c: c.bulkCode }) : `#${c.orderNo}`} · {c.customerName || tr('Customer')} · {ago(c.createdAt)}</Text>
                                    </View>
                                    {c.status === 'resolved' ? <Pill label={RESOLUTION_TEXT[c.resolution] || tr('Decided')} color={ok} /> : c.status === 'in_progress' ? <Pill label={tr('In progress')} color={primary} /> : <Pill label={tr('New')} color={error} />}
                                </View>
                                <Text style={{ color: text, marginTop: 12, lineHeight: 20 }} numberOfLines={3}>{c.text}</Text>
                                {c.photos?.length ? <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}><Ionicons name="images-outline" size={14} color={muted} /><Text style={{ color: muted, fontSize: 12.5, fontWeight: '700', marginLeft: 5 }}>{c.photos.length}</Text></View> : null}
                            </Pressable>
                        </GlowBorder>
                    </View>
                ) : (
                    <GlowBorder active={c.status !== 'resolved'} radius={18} style={{ marginHorizontal: 16, marginBottom: 12 }}>
                    <Card onPress={() => nav.navigate('OwnerComplaint', { complaint: c })} style={{ marginHorizontal: 0, marginBottom: 0 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: text, fontWeight: '900', flex: 1 }} numberOfLines={1}>{tr(c.bulkCode ? 'Bulk order {c} · {v2}' : 'Order #{orderNo} · {v2}', { c: c.bulkCode, orderNo: c.orderNo, v2: COMPLAINT_TYPES[c.type] || c.type })}</Text>
                            {c.status === 'resolved' ? <Pill label={RESOLUTION_TEXT[c.resolution] || tr('Decided')} color={ok} /> : c.status === 'in_progress' ? <Pill label={tr('In progress')} color={primary} /> : <Pill label={tr('New')} color={error} />}
                        </View>
                        <Text style={{ color: text, marginTop: 6 }} numberOfLines={2}>{c.text}</Text>
                        <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{c.customerName || tr('Customer')} · {ago(c.createdAt)}{c.photos?.length ? tr(c.photos.length > 1 ? ' · {length} photos' : ' · {length} photo', { length: c.photos.length }) : ''}</Text>
                    </Card>
                    </GlowBorder>
                )}
                ListEmptyComponent={items === null ? <ListShimmer /> : err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <Empty icon="happy-outline" title={status === 'open' ? tr('No new complaints') : tr('Nothing here')} hint={status === 'open' ? tr('Nice. Customers are happy.') : undefined} />}
                ListFooterComponent={more ? <Pressable onPress={() => load(page + 1)} style={{ padding: 18, alignItems: 'center' }}><Text style={{ color: primary, fontWeight: '800' }}>{tr('Show more')}</Text></Pressable> : null}
            />
            </View>
        </View>
    );
}
