import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, ScrollView, Pressable } from 'react-native';
import { ActivityIndicator } from '../../components/Loading';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Badge, IconTile } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { FunnelButton, FilterPopup } from '../../components/FilterPopup';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import SwipeAway from '../../components/SwipeAway';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import usePagedList from '../../hooks/usePagedList';
import { useInboxStore } from '../../store/useInboxStore';
import { fetchInbox, readAllInbox, readInbox, clearInbox, deleteInboxItem } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';
import { ago, titleCase } from '../../utils/format';
import { toAdmin } from '../../navigation/goTo';

// where an alert leads, by what it is about. The shop's own page is the fallback for anything that names a shop.
const SHOP_PAGE = {
    admin_refund_failed: 'ShopPayments', admin_webhook_failed: 'ShopPayments',
    admin_sms_low: 'ShopSms', admin_sms_zero: 'ShopSms', admin_sms_topup_done: 'ShopSms',
    admin_bill_issued: 'ShopBilling', admin_bill_paid: 'ShopBilling', admin_grace_ending: 'ShopBilling', admin_free_ending: 'ShopBilling', admin_free_ended: 'ShopBilling',
};
const PLATFORM_PAGE = {   // alerts about no particular shop
    admin_webhook_failed: 'MyRazorpay', admin_refund_failed: 'MyRazorpay', admin_sms_provider_failing: 'SmsProvider', admin_sms_low: 'PlatformSms', admin_sms_zero: 'PlatformSms',
    admin_wallet_mismatch: 'System', admin_platform_red: 'PlatformHealth',
};

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
    const [kind, setKind] = useState('');
    const [q, setQ] = useState('');
    const [dq, setDq] = useState('');
    const [filters, setFilters] = useState(false);
    useEffect(() => { const id = setTimeout(() => setDq(q.trim()), 350); return () => clearTimeout(id); }, [q]);
    const word = [dq, kind].filter(Boolean).join(' ');
    const activeCount = (unreadOnly ? 1 : 0) + (kind ? 1 : 0);
    const [busy, setBusy] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const first = useRef(true);
    const listRef = useRef(null);
    const offset = useRef(0);   // how far the list is scrolled, so coming back from a card keeps your place
    const autoRead = useRef(false);
    const setUnread = useInboxStore((s) => s.setUnread);

    const list = usePagedList(async (page) => {
        const r = await fetchInbox({ page, limit: 20, ...(unreadOnly ? { unread: 'true' } : {}), ...(word ? { q: word } : {}) });
        setUnread(r.unreadCount || 0);
        return { items: r.items, hasMore: r.hasMore, page: r.page };
    }, [unreadOnly, word]);

    useEffect(() => {
        if (list.state !== 'ready' || autoRead.current) return;
        autoRead.current = true;
        readAllInbox().then(() => setUnread(0)).catch(() => { });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [list.state]);

    useFocusEffect(useCallback(() => {
        if (first.current) { first.current = false; return; }
        // a quiet refresh puts the list back to its first page: only do it when you are at the top, so the place you scrolled to is not lost
        if (offset.current < 80) list.silentReload();
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
        if (d.kind === 'toClose') nav.navigate('ShopsToClose');
        else if (d.kind === 'health') toAdmin(nav, { screen: 'HomeTab', params: { screen: 'PlatformHealth' } });
        else if (d.ticketId) nav.navigate('SupportDetail', { id: String(d.ticketId) });
        else if (d.orderId) toAdmin(nav, { screen: 'OrdersTab', params: { screen: 'OrderDetail', params: { orderId: String(d.orderId), orderNo: d.orderNo } } });
        else if (d.invoiceId) toAdmin(nav, { screen: 'MoneyTab', params: { screen: 'InvoiceDetail', params: { invoiceId: String(d.invoiceId) } } });
        else {
            const shopId = n.shop?.id || d.tenantId || n.tenantId;
            const shopName = n.shop?.name || d.shopName;
            const page = SHOP_PAGE[n.type];
            if (shopId && page) toAdmin(nav, { screen: 'MoneyTab', params: { screen: page, params: { shopId: String(shopId), name: shopName } } });
            else if (shopId) toAdmin(nav, { screen: 'ShopsTab', params: { screen: 'ShopDetail', params: { shopId: String(shopId), name: shopName } } });
            else if (n.type === 'admin_daily_summary') toAdmin(nav, { screen: 'OrdersTab', params: { screen: 'SalesReport' } });
            else if (PLATFORM_PAGE[n.type]) toAdmin(nav, { screen: 'MoneyTab', params: { screen: PLATFORM_PAGE[n.type] } });
            else toast('Nothing more to open for this alert');
        }
    };

    return (
        <GestureHandlerRootView style={{ flex: 1 }}>
        <Screen title="Alerts" subtitle="Things that need you" scroll={false} right={<HeaderButton icon="trash" onPress={() => setConfirmClear(true)} />}>
            <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, marginRight: spacing.md }}>
                    <SearchBar value={q} onChangeText={setQ} placeholder="Search alerts" />
                </View>
                <FunnelButton count={activeCount} onPress={() => setFilters(true)} />
            </View>
            <FilterPopup
                visible={filters}
                onClose={() => setFilters(false)}
                title="Filter alerts"
                activeCount={activeCount}
                onClear={() => { setUnreadOnly(false); setKind(''); }}
                sections={[
                    { key: 'show', title: 'Show', options: [[false, 'All'], [true, 'Unread only']], value: unreadOnly, onChange: setUnreadOnly },
                    { key: 'kind', title: 'About', options: [['', 'Everything'], ['order', 'Orders'], ['bill', 'Bills'], ['sms', 'SMS'], ['payment', 'Payments'], ['complaint', 'Complaints'], ['shop', 'Shops']], value: kind, onChange: setKind },
                ]}
            />
            {list.state === 'loading' ? <SkeletonList /> : list.state === 'error' ? <ErrorBox message={list.error} onRetry={list.reload} /> : (
                <FlatList
                    ref={listRef}
                    onScroll={(e) => { offset.current = e.nativeEvent.contentOffset.y; }}
                    scrollEventThrottle={32}
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
                            <SwipeAway onDismiss={() => removeOne(n)}>
                            <View style={{ paddingBottom: spacing.md }}>
                                <Pressable
                                    onPress={() => open(n)}
                                    accessibilityRole="button"
                                    style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, paddingRight: 52, borderRadius: radius.lg, backgroundColor: t.surface, borderWidth: 1, borderColor: n.read ? t.border : c, opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.985 : 1 }] }, t.shadow]}
                                >
                                    <View style={{ marginRight: spacing.md }}>
                                        <IconTile icon={icon} section={section} size={44} />
                                        {!n.read ? <View style={{ position: 'absolute', top: -3, right: -3, width: 12, height: 12, borderRadius: 6, backgroundColor: c, borderWidth: 2, borderColor: t.surface }} /> : null}
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: t.text, fontWeight: n.read ? '700' : '800', fontSize: font.md }}>{n.title}</Text>
                                        {n.body ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 3, lineHeight: 19 }} numberOfLines={3}>{n.body}</Text> : null}
                                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' }}>
                                            {n.shop?.name ? <Badge label={n.shop.name} tone="primary" icon="shops" /> : null}
                                            <Text style={{ color: t.muted, fontSize: font.xs, fontWeight: '600' }}>{ago(n.createdAt)}</Text>
                                        </View>
                                    </View>
                                </Pressable>
                                {/* the remove button sits beside the card (not inside it) in its own small round spot, so a tap on the card never reaches it */}
                                <Pressable onPress={() => removeOne(n)} accessibilityRole="button" accessibilityLabel="Remove this alert" style={({ pressed }) => ({ position: 'absolute', top: 8, right: 8, width: 32, height: 32, borderRadius: 16, backgroundColor: t.surfaceAlt, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
                                    <Icon name="clear" size={16} color={t.muted} />
                                </Pressable>
                            </View>
                            </SwipeAway>
                        );
                    }}
                />
            )}
            <ConfirmSheet
                visible={confirmClear}
                onClose={() => setConfirmClear(false)}
                icon="trash"
                title="Clear all alerts?"
                message="Every alert in this list is deleted for good. This cannot be undone."
                confirmLabel="Clear all"
                danger
                onConfirm={clearAll}
            />
        </Screen>
        </GestureHandlerRootView>
    );
}
