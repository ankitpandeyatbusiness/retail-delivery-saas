// Customers of the shop: filter by how they are doing (slipping, lost, new, regular, loyal, VIP), search by name or phone.
// Tap one for his page; "Remind" on a row sends him a friendly nudge (push and his in-app inbox).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Field, Empty } from '../../components/owners/ui';
import RemindSheet from '../../components/owners/RemindSheet';
import { fetchCustomers, fetchCustomerInsights, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { personName } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { TAGS, TAG_ORDER, usualLine, sinceLine } from '../../utils/owners/customerTags';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';

export default function OwnerCustomersScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, border, onPrimary } = useBrand();
    const [typed, setTyped] = useState('');
    const [q, setQ] = useState('');
    const [tag, setTag] = useState('all');
    const [counts, setCounts] = useState(null);
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);
    const [remind, setRemind] = useState(null);
    const t = useRef(null);
    const seq = useRef(0);

    const load = useCallback(async (p, query, which) => {
        const mine = ++seq.current;
        try {
            // "Everyone" is the plain list (it also has people who never ordered); the tags come from the profiles
            const r = which === 'all'
                ? await fetchCustomers({ q: query || undefined, page: p, limit: 20 })
                : await fetchCustomerInsights({ q: query || undefined, tag: which, page: p, limit: 20 });
            if (mine !== seq.current) return;
            if (r.counts) setCounts(r.counts);
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) {
            if (mine !== seq.current) return;
            useOwnerStore.getState().noteError(e);
            setErr(apiError(e, 'Could not load your customers.')); setItems((x) => x || []);
        } finally { setLoadingMore(false); }
    }, []);

    useEffect(() => { setItems(null); load(1, q, tag); }, [q, tag, load]);
    // the numbers on the chips, and again when we come back from a customer's page
    useFocusEffect(useCallback(() => { fetchCustomerInsights({ limit: 1 }).then((r) => setCounts(r.counts)).catch(() => { }); }, []));
    const onType = (v) => { setTyped(v); clearTimeout(t.current); t.current = setTimeout(() => setQ(v.trim()), 400); };

    const chip = (key, label, n) => {
        const on = tag === key;
        return (
            <Pressable key={key} onPress={() => setTag(key)} style={{ marginRight: 8, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
                <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{label}{n !== undefined && n !== null ? ` ${n}` : ''}</Text>
            </Pressable>
        );
    };

    const header = (
        <View style={{ paddingBottom: 6 }}>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Field value={typed} onChangeText={onType} placeholder="Search by name or phone" maxLength={40} style={{ minHeight: 44 }} /></View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }} style={{ flexGrow: 0 }}>
                {chip('all', 'Everyone')}
                {TAG_ORDER.map((k) => chip(k, TAGS[k].label, counts ? counts[k] : null))}
            </ScrollView>
            {tag !== 'all' ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginTop: 8 }}>{TAGS[tag].hint}</Text> : null}
            <Pressable onPress={() => nav.navigate('OwnerAutopilot')} style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.1), flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="rocket" size={20} color={primary} />
                <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 10 }}>Autopilot: reminders that go out by themselves</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Customers" />
            <FlatList
                data={items || []}
                keyExtractor={(u) => String(u.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 60 }}
                ListHeaderComponent={header}
                renderItem={({ item: u }) => {
                    const tg = TAGS[u.tag];
                    const canRemind = u.id && u.orders > 0;
                    return (
                        <Pressable onPress={() => nav.navigate('OwnerCustomer', { id: String(u.id) })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
                            <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                                <Text style={{ color: primary, fontWeight: '900', fontSize: 17 }}>{personName(u).replace(/^Customer\s*/, '').charAt(0).toUpperCase() || '?'}</Text>
                            </View>
                            <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ color: text, fontWeight: '800', fontSize: 15, flexShrink: 1 }} numberOfLines={1}>{personName(u)}</Text>
                                    {tg ? <Text style={{ color: tg.color, backgroundColor: alpha(tg.color, 0.12), fontSize: 10, fontWeight: '900', marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' }}>{u.vip && u.tag !== 'vip' ? `VIP · ${tg.label}` : tg.label}</Text> : null}
                                </View>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{u.orders !== undefined ? `${sinceLine(u)} · ${usualLine(u)}` : `${u.phone} · joined ${ago(u.createdAt)}`}</Text>
                            </View>
                            {canRemind && (u.tag === 'slipping' || u.tag === 'lost') ? (
                                <Pressable onPress={() => setRemind(u)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: primary }}>
                                    <Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>Remind</Text>
                                </Pressable>
                            ) : <Ionicons name="chevron-forward" size={18} color={muted} />}
                        </Pressable>
                    );
                }}
                ListEmptyComponent={items === null ? <ListShimmer rows count={6} /> : err ? <Empty icon="cloud-offline-outline" title="Could not load" hint={err} /> : <Empty icon="people-outline" title={q ? 'No customer found' : tag === 'all' ? 'No customers yet' : `No ${TAGS[tag].label.toLowerCase()} customers`} hint={q ? 'Try another name or number.' : tag === 'all' ? 'Customers appear here when they sign in to your app.' : 'Good news: nobody is here right now.'} />}
                ListFooterComponent={more ? <Pressable onPress={() => { setLoadingMore(true); load(page + 1, q, tag); }} style={{ padding: 18, alignItems: 'center' }}>{loadingMore ? <LineShimmer width={90} height={16} /> : <Text style={{ color: primary, fontWeight: '800' }}>Show more</Text>}</Pressable> : null}
            />
            {remind ? <RemindSheet visible customer={remind} onClose={() => setRemind(null)} onSent={() => load(1, q, tag)} /> : null}
        </View>
    );
}
