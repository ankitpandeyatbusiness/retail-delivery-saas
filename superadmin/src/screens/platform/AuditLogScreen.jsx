import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable } from 'react-native';
import { ActivityIndicator } from '../../components/Loading';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Chip, Badge } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, Sheet, SheetScroll } from '../../components/feedback';
import Icon from '../../components/Icon';
import usePagedList from '../../hooks/usePagedList';
import { useShopsStore } from '../../store/useShopsStore';
import { listAudit } from '../../api/platformApi';
import { dateTime, titleCase } from '../../utils/format';

const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const WHO = [
    { value: '', label: 'Everyone' }, { value: 'superadmin', label: 'Superadmins' }, { value: 'owner', label: 'Owners' },
    { value: 'rider', label: 'Riders' }, { value: 'system', label: 'Automatic' },
];
const RANGE = [{ value: 'all', label: 'Any time' }, { value: 'today', label: 'Today' }, { value: '7', label: '7 days' }, { value: '30', label: '30 days' }];
const TONE = { superadmin: 'warn', owner: 'primary', rider: 'success', system: 'neutral' };

// "PATCH /api/admin/tenants/65f.../shop/orders/abc/status" -> "Orders › Status"
const readable = (a = '') => {
    if (/^[A-Z_]+$/.test(a)) return titleCase(a.toLowerCase());
    const noVerb = a.replace(/^[A-Z]+\s+/, '');
    const parts = noVerb.replace(/^\/api\/(admin\/)?(tenants\/[^/]+\/)?(shop\/)?/, '').split('/').filter((p) => p && !/^[a-f0-9]{24}$/i.test(p));
    return titleCase(parts.join(' › ') || a);
};
const verbOf = (a = '') => (/^(POST|PUT|PATCH|DELETE|GET)\s/.exec(a) || [])[1] || '';

// Every change made on the platform: who did what, where, and when.
export default function AuditLogScreen() {
    const t = useTheme();
    const shops = useShopsStore((s) => s.items);
    const [who, setWho] = useState('');
    const [shopId, setShopId] = useState('');
    const [range, setRange] = useState('7');
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [picker, setPicker] = useState(false);
    const [row, setRow] = useState(null);

    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(id); }, [q]);
    useEffect(() => { if (!shops.length) useShopsStore.getState().load(); }, [shops.length]);

    const params = useMemo(() => ({
        ...(who ? { actorType: who } : {}),
        ...(shopId ? { tenantId: shopId } : {}),
        ...(dq ? { q: dq } : {}),
        ...(range === 'today' ? { from: ymd(new Date()) } : range !== 'all' ? { from: ymd(new Date(Date.now() - Number(range) * 86400000)) } : {}),
    }), [who, shopId, dq, range]);

    const list = usePagedList((page) => listAudit({ ...params, page, limit: 30 }), [params]);
    const shopName = shops.find((s) => s._id === shopId)?.name;
    const shopOf = (id) => shops.find((s) => String(s._id) === String(id))?.name;

    return (
        <Screen title="Audit log" subtitle="Who changed what" scroll={false}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
                <SearchBar value={q} onChangeText={setQ} placeholder="Search an action, like coupons or owners" />
            </View>
            <View style={{ height: 52, marginTop: spacing.sm }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {WHO.map((w) => <Chip key={w.label} label={w.label} active={who === w.value} onPress={() => setWho(w.value)} />)}
                </ScrollView>
            </View>
            <View style={{ height: 48 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    <Chip label={shopId ? (shopName || 'Shop') : 'All shops'} icon="shops" active={!!shopId} onPress={() => setPicker(true)} />
                    {RANGE.map((r) => <Chip key={r.value} label={r.label} active={range === r.value} onPress={() => setRange(r.value)} />)}
                </ScrollView>
            </View>

            {list.state === 'loading' ? <SkeletonList avatar={false} /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(a, i) => `${a._id || a.at}-${i}`}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="notes" title="Nothing found" hint="Try another period or filter." />}
                    renderItem={({ item: a }) => (
                        <Card onPress={() => setRow(a)} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1, paddingRight: spacing.md }} numberOfLines={2}>{readable(a.action)}</Text>
                                {a.status >= 400 ? <Badge label={`Failed ${a.status}`} tone="danger" /> : null}
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm, marginTop: 6 }}>
                                <Badge label={a.actorPhone || a.actorLabel || titleCase(a.actorType)} tone={TONE[a.actorType] || 'neutral'} />
                                {a.tenantId && shopOf(a.tenantId) ? <Badge label={shopOf(a.tenantId)} icon="shops" /> : null}
                                {verbOf(a.action) ? <Badge label={verbOf(a.action)} /> : null}
                                <Text style={{ color: t.muted, fontSize: font.xs }}>{dateTime(a.at)}</Text>
                            </View>
                        </Card>
                    )}
                />
            )}

            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shop?">
                <SheetScroll style={{ maxHeight: 380 }}>
                    <Pressable onPress={() => { setShopId(''); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row' }}>
                        <Text style={{ flex: 1, color: t.text, fontWeight: '800' }}>All shops</Text>
                        {!shopId ? <Icon name="ok" size={20} color={t.primary} /> : null}
                    </Pressable>
                    {shops.map((s) => (
                        <Pressable key={s._id} onPress={() => { setShopId(s._id); setPicker(false); }} style={{ paddingVertical: spacing.md, flexDirection: 'row', borderTopWidth: 0.5, borderTopColor: t.border }}>
                            <Text style={{ flex: 1, color: t.text, fontWeight: '700' }} numberOfLines={1}>{s.name}</Text>
                            {shopId === s._id ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </Pressable>
                    ))}
                </SheetScroll>
            </Sheet>

            <Sheet visible={!!row} onClose={() => setRow(null)} title="Details">
                {row ? (
                    <View>
                        <Text selectable style={{ color: t.text, fontWeight: '800', marginBottom: spacing.sm }}>{row.action}</Text>
                        <Text style={{ color: t.muted }}>Who: {row.actorPhone || row.actorLabel || row.actorType}{row.actorName ? ` (${row.actorName})` : ''}</Text>
                        <Text style={{ color: t.muted }}>When: {dateTime(row.at)}</Text>
                        {row.ip ? <Text style={{ color: t.muted }}>From: {row.ip}</Text> : null}
                        {row.status ? <Text style={{ color: t.muted }}>Result: {row.status}</Text> : null}
                        {row.params ? <Text selectable style={{ color: t.muted, marginTop: spacing.sm, fontSize: font.sm }}>{JSON.stringify(row.params, null, 1)}</Text> : null}
                        {row.before ? <Text selectable style={{ color: t.muted, marginTop: spacing.sm, fontSize: font.xs }}>Before: {JSON.stringify(row.before).slice(0, 600)}</Text> : null}
                    </View>
                ) : null}
            </Sheet>
        </Screen>
    );
}
