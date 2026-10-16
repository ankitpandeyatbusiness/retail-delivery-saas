import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Chip, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import usePagedList from '../../hooks/usePagedList';
import { useInboxStore } from '../../store/useInboxStore';
import { fetchInbox, readAllInbox, readInbox, clearInbox, deleteInboxItem } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';
import { ago, titleCase } from '../../utils/format';

// what an alert is about -> an icon and a colour family
const KIND = [
    [/order|late|stuck|delivery/i, 'orders', 'orders'],
    [/bill|invoice|rent|paid|paus|billing/i, 'receipt', 'money'],
    [/sms|wallet/i, 'message', 'catalog'],
    [/payment|refund|dispute|razorpay/i, 'wallet', 'money'],
    [/complaint/i, 'message', 'alerts'],
    [/shop|inactive|owner/i, 'shops', 'shops'],
];
const kindOf = (type = '', title = '') => KIND.find(([re]) => re.test(type) || re.test(title)) || [null, 'bell', 'platform'];

// Alerts for the platform owner: late orders, unpaid bills, SMS problems, payment trouble.
export default function InboxScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [unreadOnly, setUnreadOnly] = useState(false);
    const [busy, setBusy] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const first = useRef(true);
    const autoRead = useRef(false);
    const setUnread = useInboxStore((s) => s.setUnread);

    const list = usePagedList(async (page) => {
        const r = await fetchInbox({ page, limit: 20, ...(unreadOnly ? { unread: 'true' } : {}) });
        setUnread(r.unreadCount || 0);
        return { items: r.items, hasMore: r.hasMore, page: r.page };
    }, [unreadOnly]);

    useEffect(() => {
        if (list.state !== 'ready' || autoRead.current) return;
        autoRead.current = true;
        readAllInbox().then(() => setUnread(0)).catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.state]);

    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        list.silentReload();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []));

    const markAll = async () => {
        setBusy(true);
        try { await readAllInbox(); list.setItems((c) => c.map((x) => ({ ...x, read: true }))); setUnread(0); toast('All marked as read'); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const clearAll = async () => {
        try { await clearInbox(); list.setItems(() => []); setUnread(0); toast('All alerts cleared'); } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };

    const removeOne = async (n) => {
        list.setItems((c) => c.filter((x) => x.id !== n.id));
        try { await deleteInboxItem(n.id); } catch (e) { toast(errMsg(e), 'error'); list.silentReload(); }
    };

    const open = async (n) => {
        if (!n.read) {
            list.setItems((c) => c.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
            useInboxStore.getState().setUnread(useInboxStore.getState().unread - 1);
            readInbox(n.id).catch(() => { });
        }
        const d = n.data || {};
        if (d.entryId) nav.navigate('Admin', { screen: 'MoreTab', params: { screen: 'SettlementEntry', params: { id: String(d.entryId) } } });
        else if (d.ticketId) nav.navigate('SupportDetail', { id: String(d.ticketId) });
        else if (d.orderId) nav.navigate('Admin', { screen: 'OrdersTab', params: { screen: 'OrderDetail', params: { orderId: String(d.orderId), orderNo: d.orderNo } } });
        else if (d.invoiceId) nav.navigate('Admin', { screen: 'MoneyTab', params: { screen: 'InvoiceDetail', params: { invoiceId: String(d.invoiceId) } } });
        else if (n.shop?.id) nav.navigate('Admin', { screen: 'ShopsTab', params: { screen: 'ShopDetail', params: { shopId: String(n.shop.id), name: n.shop.name } } });
    };

    return (
        <Screen title="Alerts" subtitle="Things that need you" scroll={false} right={<HeaderButton icon="trash" onPress={() => setConfirmClear(true)} />}>
            <View style={{ height: 52, marginTop: spacing.md }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    <Chip label="All" active={!unreadOnly} onPress={() => setUnreadOnly(false)} />
                    <Chip label="Unread" active={unreadOnly} onPress={() => setUnreadOnly(true)} />
                </ScrollView>
            </View>
            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    data={list.items}
                    keyExtractor={(n) => String(n.id)}
                    contentContainerStyle={{ padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxl * 2, flexGrow: 1 }}
                    refreshing={list.refreshing}
                    onRefresh={list.refresh}
                    onEndReached={list.loadMore}
                    onEndReachedThreshold={0.4}
                    ListFooterComponent={list.more ? <ActivityIndicator color={t.primary} style={{ margin: spacing.lg }} /> : null}
                    ListEmptyComponent={<Empty icon="bell" title={unreadOnly ? 'Nothing unread' : 'No alerts yet'} hint="Late orders, unpaid bills and problems show up here." />}
                    renderItem={({ item: n }) => {
                        const [, icon, section] = kindOf(n.type, n.title);
                        const c = t.sections[section]?.color || t.primary;
                        return (
                            <Pressable
                                onPress={() => open(n)}
                                style={({ pressed }) => [{ flexDirection: 'row', padding: spacing.md, marginBottom: spacing.sm, borderRadius: radius.lg, backgroundColor: n.read ? t.surface : t.primarySoft, opacity: pressed ? 0.9 : 1 }, !n.read && { borderLeftWidth: 4, borderLeftColor: c }]}
                            >
                                <View style={{ width: 42, height: 42, borderRadius: 14, backgroundColor: `${c}22`, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md }}>
                                    <Icon name={icon} size={22} color={c} />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: t.text, fontWeight: n.read ? '600' : '800', fontSize: font.md }}>{n.title}</Text>
                                    {n.body ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={3}>{n.body}</Text> : null}
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: 6, flexWrap: 'wrap' }}>
                                        {n.shop?.name ? <Badge label={n.shop.name} tone="primary" icon="shops" /> : null}
                                        <Text style={{ color: t.muted, fontSize: font.xs }}>{ago(n.createdAt)}</Text>
                                    </View>
                                </View>
                                <Pressable onPress={() => removeOne(n)} hitSlop={10} style={{ paddingLeft: spacing.sm, justifyContent: 'flex-start' }}>
                                    <Icon name="clear" size={20} color={t.muted} />
                                </Pressable>
                            </Pressable>
                        );
                    }}
                />
            )}
            <ConfirmSheet
                visible={confirmClear}
                onClose={() => setConfirmClear(false)}
                title="Clear all alerts?"
                message="Every alert in this list is deleted for good."
                confirmLabel="Clear all"
                danger
                onConfirm={clearAll}
            />
        </Screen>
    );
}
