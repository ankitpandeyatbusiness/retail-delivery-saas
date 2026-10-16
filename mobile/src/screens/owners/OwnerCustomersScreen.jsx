// Customers of the shop: search by name or phone, newest first. Tap one for his page.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Field, Empty } from '../../components/owners/ui';
import { fetchCustomers, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { personName } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';

export default function OwnerCustomersScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
    const [typed, setTyped] = useState('');
    const [q, setQ] = useState('');
    const [items, setItems] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');
    const [loadingMore, setLoadingMore] = useState(false);
    const t = useRef(null);
    const seq = useRef(0);

    const load = useCallback(async (p, query) => {
        const mine = ++seq.current;
        try {
            const r = await fetchCustomers({ q: query || undefined, page: p, limit: 20 });
            if (mine !== seq.current) return;
            setItems((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore); setPage(p); setErr('');
        } catch (e) {
            if (mine !== seq.current) return;
            useOwnerStore.getState().noteError(e);
            setErr(apiError(e, 'Could not load your customers.')); setItems((x) => x || []);
        } finally { setLoadingMore(false); }
    }, []);

    useEffect(() => { setItems(null); load(1, q); }, [q, load]);
    const onType = (v) => { setTyped(v); clearTimeout(t.current); t.current = setTimeout(() => setQ(v.trim()), 400); };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Customers" />
            <FlatList
                data={items || []}
                keyExtractor={(u) => String(u.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 60 }}
                ListHeaderComponent={<View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Field value={typed} onChangeText={onType} placeholder="Search by name or phone" maxLength={40} style={{ minHeight: 44 }} /></View>}
                renderItem={({ item: u }) => (
                    <Pressable onPress={() => nav.navigate('OwnerCustomer', { id: String(u.id) })} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
                        <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}>
                            <Text style={{ color: primary, fontWeight: '900', fontSize: 17 }}>{personName(u).replace(/^Customer\s*/, '').charAt(0).toUpperCase() || '?'}</Text>
                        </View>
                        <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{personName(u)}</Text>
                            <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{u.phone} · joined {ago(u.createdAt)}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </Pressable>
                )}
                ListEmptyComponent={items === null ? <ListShimmer rows count={6} /> : err ? <Empty icon="cloud-offline-outline" title="Could not load" hint={err} /> : <Empty icon="people-outline" title={q ? 'No customer found' : 'No customers yet'} hint={q ? 'Try another name or number.' : 'Customers appear here when they sign in to your app.'} />}
                ListFooterComponent={more ? <Pressable onPress={() => { setLoadingMore(true); load(page + 1, q); }} style={{ padding: 18, alignItems: 'center' }}>{loadingMore ? <LineShimmer width={90} height={16} /> : <Text style={{ color: primary, fontWeight: '800' }}>Show more</Text>}</Pressable> : null}
            />
        </View>
    );
}
