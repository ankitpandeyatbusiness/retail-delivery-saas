import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, ListRow, Badge, Button } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Empty } from '../../components/feedback';
import { fetchServiceInquiries, fetchServiceBookings } from '../../api/servicesApi';
import { errMsg } from '../../api/adminClient';
import { rs } from './ServicesOverviewScreen';

const INQ = [['', 'All'], ['new', 'New'], ['replied', 'Replied'], ['quoted', 'Quoted'], ['confirmed', 'Confirmed'], ['rejected', 'Rejected'], ['closed', 'Closed']];
const BOOK = [['', 'All'], ['confirmed', 'Booked'], ['seated', 'Seated'], ['no_show', 'No-show'], ['cancelled', 'Cancelled']];
const when = (d) => new Date(d).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const tone = (s) => (s === 'confirmed' || s === 'seated' ? 'ok' : s === 'rejected' || s === 'cancelled' || s === 'no_show' ? 'danger' : 'neutral');

// One shop's inquiries and bookings, to read.
export default function ServicesShopScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { tenantId, name, days } = useRoute().params || {};
    const [tab, setTab] = useState('inquiries');
    const [status, setStatus] = useState('');
    const [rows, setRows] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    const load = useCallback(async (p = 1) => {
        setErr('');
        try {
            const r = await (tab === 'inquiries' ? fetchServiceInquiries : fetchServiceBookings)({ tenantId, status: status || undefined, days: days || 30, page: p, limit: 30 });
            setRows((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p);
        } catch (e) { setErr(errMsg(e)); }
    }, [tab, status, tenantId, days]);
    useFocusEffect(useCallback(() => { setRows(null); load(1); }, [load]));
    const pick = (x) => { setTab(x); setStatus(''); setRows(null); };

    return (
        <Screen title={name || 'Shop'} subtitle="Services and booking, read only" onRefresh={() => load(1)}>
            <View style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
                <Chip label="Inquiries" active={tab === 'inquiries'} onPress={() => pick('inquiries')} />
                <Chip label="Bookings" active={tab === 'bookings'} onPress={() => pick('bookings')} />
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
                {(tab === 'inquiries' ? INQ : BOOK).map(([v, l]) => <Chip key={v} label={l} active={status === v} onPress={() => { setStatus(v); setRows(null); }} />)}
            </View>
            {err ? <ErrorBox message={err} onRetry={() => load(1)} /> : rows === null ? <SkeletonList count={4} avatar={false} /> : !rows.length ? <Empty icon="file-tray-outline" title="Nothing here" /> : (
                <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                    {rows.map((r, i) => (tab === 'inquiries' ? (
                        <ListRow key={r._id} section="orders" icon="message" last={i === rows.length - 1} title={`${r.name} · ${r.serviceName}`}
                            subtitle={`${r.messageCount} messages · ${when(r.lastMessageAt || r.createdAt)}${r.ownerUnread ? ' · owner has not opened it' : ''}`}
                            right={<Badge label={r.status} tone={tone(r.status)} />} onPress={() => nav.navigate('ServicesInquiry', { id: r._id })} />
                    ) : (
                        <ListRow key={r._id} section="orders" icon="notes" last={i === rows.length - 1}
                            title={`${r.date} ${r.time}${r.table ? ` · Table ${r.table}` : ''} · ${r.party} guests`}
                            subtitle={`${r.name} · ${r.phone} · Deposit ${rs(r.deposit?.amount)} (${(r.deposit?.status || '').replace('_', ' ')})`}
                            right={<Badge label={r.status.replace('_', ' ')} tone={tone(r.status)} />} />
                    )))}
                </Card>
            )}
            {more ? <Button title="Load more" kind="secondary" onPress={() => load(page + 1)} style={{ marginTop: spacing.md }} /> : null}
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>You can read these. Only the shop's owner replies or changes a booking.</Text>
        </Screen>
    );
}
