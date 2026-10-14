import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Chip, Button } from '../../components/ui';
import { InvoiceRow } from '../../components/invoiceBits';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, Sheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import usePagedList from '../../hooks/usePagedList';
import { useShopsStore } from '../../store/useShopsStore';
import { listInvoices, generateInvoices } from '../../api/moneyApi';
import { errMsg } from '../../api/adminClient';

const CHIPS = [
    { value: '', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'overdue', label: 'Overdue' },
    { value: 'paid', label: 'Paid' },
    { value: 'void', label: 'Void' },
];

// last month as "2026-09" (India time)
const lastMonth = () => {
    const d = new Date(Date.now() + 330 * 60000);
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
};
const monthsBack = (n) => {
    const out = [];
    const d = new Date(Date.now() + 330 * 60000);
    d.setUTCDate(1);
    for (let i = 1; i <= n; i += 1) { d.setUTCMonth(d.getUTCMonth() - 1); out.push(d.toISOString().slice(0, 7)); }
    return out;
};

// The monthly app-rent invoices you send to shops. Opened from Money, or for one shop from its billing screen.
export default function InvoicesScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const params = useRoute().params || {};
    const [status, setStatus] = useState(params.status || '');
    const [shopId, setShopId] = useState(params.shopId || '');
    const [picker, setPicker] = useState(false);
    const [gen, setGen] = useState(false);
    const [period, setPeriod] = useState(lastMonth());
    const [busy, setBusy] = useState(false);
    const shops = useShopsStore((s) => s.items);
    const first = useRef(true);

    useEffect(() => { if (!params.shopId && !shops.length) useShopsStore.getState().load(); }, [params.shopId, shops.length]);

    const query = useMemo(() => ({ ...(status ? { status } : {}), ...(shopId ? { tenantId: shopId } : {}) }), [status, shopId]);
    const list = usePagedList((page) => listInvoices({ ...query, page, limit: 20 }), [query]);

    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));

    const shopName = params.name || shops.find((s) => s._id === shopId)?.name;

    const generate = async () => {
        setBusy(true);
        try {
            const r = await generateInvoices({ period, ...(shopId ? { tenantId: shopId } : {}) });
            toast(`Created ${r.created ?? r.count ?? 0} invoice(s) for ${period}`);
            setGen(false); list.reload();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen
            title="Rent invoices"
            subtitle={shopName || 'All shops'}
            scroll={false}
            right={<HeaderButton icon="add" onPress={() => setGen(true)} />}
        >
            <View style={{ height: 52, marginTop: spacing.md }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    {CHIPS.map((c) => <Chip key={c.label} label={c.label} active={status === c.value} onPress={() => setStatus(c.value)} />)}
                </ScrollView>
            </View>
            {!params.shopId ? (
                <View style={{ height: 48 }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                        <Chip label={shopId ? (shopName || 'Shop') : 'All shops'} icon="shops" active={!!shopId} onPress={() => setPicker(true)} />
                    </ScrollView>
                </View>
            ) : null}

            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(i) => String(i._id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="receipt" title="No invoices here" hint="Monthly invoices are made automatically after a month ends. You can also create them with +." />}
                    renderItem={({ item }) => (
                        <InvoiceRow invoice={item} showShop={!params.shopId} onPress={() => nav.navigate('InvoiceDetail', { invoiceId: String(item._id), invoiceNo: item.invoiceNo })} />
                    )}
                />
            )}

            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shop?">
                <ScrollView style={{ maxHeight: 380 }}>
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
                </ScrollView>
            </Sheet>

            <Sheet visible={gen} onClose={() => setGen(false)} title="Create monthly invoices">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>
                    Invoices are made automatically after each month. Use this if one was missed. A month that is already invoiced is skipped.
                </Text>
                <Text style={{ color: t.text, fontWeight: '700', marginBottom: 8 }}>Month</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
                    {monthsBack(6).map((m) => <View key={m} style={{ marginBottom: spacing.sm }}><Chip label={m} active={period === m} onPress={() => setPeriod(m)} /></View>)}
                </View>
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>{shopId ? `Only for ${shopName}` : 'For every shop that is due'}</Text>
                <Button title="Create invoices" icon="receipt" loading={busy} onPress={generate} />
            </Sheet>
        </Screen>
    );
}
