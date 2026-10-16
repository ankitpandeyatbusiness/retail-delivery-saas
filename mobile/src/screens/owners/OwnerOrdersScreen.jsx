// Orders: the live board. Chips for each stage (with counts), search by order number, and the orders as cards with
// Accept / Reject and the next step right on them. It refreshes by itself when an order changes anywhere.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView, RefreshControl } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Empty, Field } from '../../components/owners/ui';
import { OrderCard, useOrderActions } from '../../components/owners/orderBits';
import { useOrdersStore } from '../../store/owners/useOrdersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { onOrderUpdate } from '../../api/common/socket';
import { BOARD_FILTERS } from '../../utils/owners/orderFlow';
import { ListShimmer } from '../../components/owners/shimmer';

const ACTIVE_STAGES = ['placed', 'accepted', 'preparing', 'ready', 'out_for_delivery'];

// On the "Active" chip the orders nobody has accepted come first, oldest first (they are the ones that expire);
// everything else keeps the server's order, newest first.
function arrange(items, filter) {
    if (filter !== 'active' && filter !== 'placed') return items;
    const fresh = items.filter((o) => o.status === 'placed').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    return [...fresh, ...items.filter((o) => o.status !== 'placed')];
}

function Chip({ label, count, on, onPress, urgent }) {
    const { primary, onPrimary, text, border, error } = useBrand();
    return (
        <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: on ? primary : border, backgroundColor: on ? primary : 'transparent' }}>
            <Text style={{ color: on ? onPrimary : text, fontWeight: '800', fontSize: 13 }}>{label}</Text>
            {count > 0 ? (
                <View style={{ marginLeft: 6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? alpha(onPrimary, 0.25) : (urgent ? error : alpha(primary, 0.15)) }}>
                    <Text style={{ fontSize: 11, fontWeight: '900', color: on ? onPrimary : (urgent ? '#FFFFFF' : primary) }}>{count > 99 ? '99+' : count}</Text>
                </View>
            ) : null}
        </Pressable>
    );
}

function Skeleton() {
    const { surface, border } = useBrand();
    return (
        <View>
            {[0, 1, 2].map((i) => (
                <View key={i} style={{ marginHorizontal: 16, marginBottom: 10, padding: 14, borderRadius: 18, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                    {[120, 220, 160].map((w, k) => <View key={k} style={{ width: w, height: 12, borderRadius: 6, backgroundColor: alpha('#808080', 0.18), marginBottom: 10 }} />)}
                </View>
            ))}
        </View>
    );
}

export default function OwnerOrdersScreen() {
    const nav = useNavigation();
    const route = useRoute();
    const { primary, muted } = useBrand();
    const s = useOrdersStore();
    const access = useOwnerStore((st) => st.access);
    const live = useOwnerStore((st) => st.live);
    const [typed, setTyped] = useState('');
    const debounce = useRef(null);

    const actions = useOrderActions();

    // another screen may ask for a chip: navigate('OrdersTab', { filter: 'placed' })
    useEffect(() => {
        const f = route.params?.filter;
        if (f && BOARD_FILTERS.some((x) => x[0] === f)) useOrdersStore.getState().setFilter(f);
    }, [route.params?.filter, route.params?.stamp]);

    useFocusEffect(useCallback(() => { useOrdersStore.getState().load({ quiet: true }); useOwnerStore.getState().refresh(); }, []));

    // an order changed (new, accepted by another phone, rider answered...): refresh, but not on every single event
    useEffect(() => {
        let t = null;
        const off = onOrderUpdate(() => {
            clearTimeout(t);
            t = setTimeout(() => { useOrdersStore.getState().load({ quiet: true }); useOwnerStore.getState().refresh(); }, 400);
        });
        return () => { off(); clearTimeout(t); };
    }, []);

    const onType = (v) => {
        setTyped(v);
        clearTimeout(debounce.current);
        debounce.current = setTimeout(() => useOrdersStore.getState().setQuery(v), 400);
    };

    const active = live?.orders?.active || s.counts || {};
    const activeTotal = ACTIVE_STAGES.reduce((n, k) => n + (active[k] || 0), 0);
    const countOf = (id) => (id === 'active' ? activeTotal : (id === 'delivered' || id === 'cancelled') ? 0 : active[id] || 0);

    const data = useMemo(() => arrange(s.items, s.filter), [s.items, s.filter]);
    const searching = /^\d{1,9}$/.test(s.query.trim());

    const header = (
        <View>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}>
                <Field value={typed} onChangeText={onType} placeholder="Find by order number" maxLength={9} style={{ minHeight: 44 }} />
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
                {BOARD_FILTERS.map(([id, label]) => (
                    <Chip key={id} label={label} count={countOf(id)} on={s.filter === id} urgent={id === 'placed'} onPress={() => useOrdersStore.getState().setFilter(id)} />
                ))}
            </ScrollView>
        </View>
    );

    return (
        <OwnerScreen title="Orders" scroll={false}>
            <FlatList
                data={s.loading ? [] : data}
                keyExtractor={(o) => String(o.id)}
                ListHeaderComponent={header}
                renderItem={({ item }) => (
                    <View style={{ paddingHorizontal: 0 }}>
                        <OrderCard
                            order={item}
                            busy={actions.busyId === item.id}
                            onOpen={() => nav.navigate('OwnerOrder', { id: String(item.id) })}
                            onAdvance={actions.advance}
                            onReject={actions.requestReject}
                        />
                    </View>
                )}
                ListEmptyComponent={s.loading ? <Skeleton /> : s.error ? (
                    <Empty icon="cloud-offline-outline" title="Could not load the orders" hint={s.error} />
                ) : (
                    <Empty
                        icon="receipt-outline"
                        title={searching ? 'No order with that number' : s.filter === 'active' ? 'No orders right now' : 'Nothing here'}
                        hint={searching ? 'Check the number and try again.' : s.filter === 'active' ? 'New orders appear here the moment a customer places them, with a sound.' : 'Orders in this stage will show here.'}
                    />
                )}
                ListFooterComponent={s.loadingMore ? <ListShimmer count={1} /> : <View style={{ height: 110 }} />}
                onEndReachedThreshold={0.4}
                onEndReached={() => useOrdersStore.getState().loadMore()}
                refreshControl={<RefreshControl refreshing={s.refreshing} onRefresh={() => useOrdersStore.getState().refresh()} tintColor={primary} colors={[primary]} />}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                extraData={actions.busyId}
            />
            {access !== 'ok' && !s.loading && !data.length ? (
                <Text style={{ color: muted, textAlign: 'center', paddingHorizontal: 24, marginBottom: 90 }}>Orders in progress can still be finished.</Text>
            ) : null}
            {actions.sheets}
        </OwnerScreen>
    );
}
