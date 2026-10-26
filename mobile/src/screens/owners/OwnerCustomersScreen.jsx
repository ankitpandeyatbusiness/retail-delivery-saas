// Customers of the shop: filter by how they are doing (slipping, lost, new, regular, loyal, VIP), search by name or phone.
// Tap one for his page; "Remind" on a row sends him a friendly nudge (push and his in-app inbox).
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { PageHeader, Field, Empty, Sheet } from '../../components/owners/ui';
import { FunnelButton, FilterPopup } from '../../components/owners/FilterPopup';
import { downloadAndOpen, XLSX } from '../../utils/owners/files';
import RemindSheet from '../../components/owners/RemindSheet';
import { fetchCustomers, customersExportPath, fetchCustomerInsights, fetchBlocked, fetchDineDebts, blockCustomer, apiError } from '../../api/owners/shopApi';
import { BlockedCard } from '../../components/owners/BlockSheet';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { personName } from '../../utils/owners/hubRules';
import { ago } from '../../utils/owners/riderRules';
import { TAGS, TAG_ORDER, usualLine, sinceLine } from '../../utils/owners/customerTags';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export default function OwnerCustomersScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary, border, onPrimary } = useBrand();
    const [sheetOpen, setSheetOpen] = useState(false);
    const [filtering, setFiltering] = useState(false);
    const [fileBusy, setFileBusy] = useState('');
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
    const [blocked, setBlocked] = useState(null);   // the blocked customers (the Blocked tab)
    const [busyId, setBusyId] = useState('');
    const loadBlocked = useCallback(() => fetchBlocked().then((r) => setBlocked(r.items || [])).catch(() => setBlocked((x) => x || [])), []);
    useFocusEffect(useCallback(() => { loadBlocked(); }, [loadBlocked]));
    const unblock = async (b) => {
        let owes = 0;
        try { const r = await fetchDineDebts(); owes = (r.items || []).filter((x) => x.customers.some((u) => String(u.id) === String(b.id))).reduce((n, x) => n + x.amount, 0); } catch (e) { /* no warning */ }
        const yes = await ask({ title: tr('Unblock this customer?'), message: owes ? tr('He still owes ₹{n}. He can use the app again, but cannot order until he pays.', { n: Math.round(owes) }) : tr('He can use the app of your shop again.'), confirmText: tr('Unblock'), cancelText: tr('No') });
        if (!yes) return;
        setBusyId(b.id);
        try { await blockCustomer(b.id, false); setBlocked((l) => (l || []).filter((x) => x.id !== b.id)); showToast(tr('Customer unblocked')); } catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };
    const blockedShown = (blocked || []).filter((b) => !q || (b.name || '').toLowerCase().includes(q.toLowerCase()) || (b.phone || '').includes(q));
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

    useEffect(() => { if (tag === 'blocked') return; setItems(null); load(1, q, tag); }, [q, tag, load]);
    // the numbers on the chips, and again when we come back from a customer's page
    useFocusEffect(useCallback(() => { fetchCustomerInsights({ limit: 1 }).then((r) => setCounts(r.counts)).catch(() => { }); }, []));
    const onType = (v) => { setTyped(v); clearTimeout(t.current); t.current = setTimeout(() => setQ(v.trim()), 400); };

    const header = (
        <View style={{ paddingBottom: 6 }}>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Field value={typed} onChangeText={onType} placeholder={tr('Search by name or phone')} maxLength={40} style={{ minHeight: 44 }} /></View>
                <FunnelButton count={tag === 'all' ? 0 : 1} onPress={() => setFiltering(true)} style={{ marginLeft: 8 }} />
            </View>
            {tag !== 'all' ? <Text style={{ color: primary, fontWeight: '800', paddingHorizontal: 16, marginBottom: 4 }}>{tag === 'blocked' ? tr('Blocked') : tr(TAGS[tag]?.label || tag)}</Text> : null}
            {tag === 'blocked' ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginTop: 8 }}>{tr('Customers you blocked: when, why, and the order it was about. You can unblock them here.')}</Text> : tag !== 'all' ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginTop: 8 }}>{TAGS[tag].hint}</Text> : null}
            <Pressable onPress={() => nav.navigate('OwnerAutopilot')} style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.1), flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="rocket" size={20} color={primary} />
                <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 10 }}>{tr('Autopilot: reminders that go out by themselves')}</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Customers')} right={<Pressable onPress={() => setSheetOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Download Excel')} style={{ padding: 6 }}><Ionicons name="download-outline" size={24} color={primary} /></Pressable>} />
            <FilterPopup visible={filtering} onClose={() => setFiltering(false)} title={tr('Filter customers')} activeCount={tag === 'all' ? 0 : 1} onClear={() => setTag('all')}
                sections={[{ key: 'tag', title: 'Show', value: tag, onChange: setTag, options: [['all', 'Everyone'], ...TAG_ORDER.map((k) => [k, `${tr(TAGS[k].label)}${counts && counts[k] != null ? ` ${counts[k]}` : ''}`]), ['blocked', `${tr('Blocked')}${blocked ? ` ${blocked.length}` : ''}`]] }]} />
            <Sheet visible={sheetOpen} onClose={() => !fileBusy && setSheetOpen(false)} title={tr('Download customers as Excel')}>
                <Text style={{ color: muted, marginBottom: 10 }}>{tr('Choose a list. The sheet has orders, spend, most ordered food, the time they usually order and more.')}</Text>
                {[['all', 'All customers', 'Everyone who ordered, newest first'], ['repeat', 'Most repeating customers', 'Ordered 2 or more times, most orders first'], ['valuable', 'Most valuable customers', 'Highest spend first'], ['recent', 'Recent customers', 'Ordered in the last 30 days'], ['lapsed', 'Lapsed customers', 'No order for 30 days or more, biggest spenders first']].map(([k, label, hint]) => (
                    <Pressable key={k} disabled={!!fileBusy} onPress={async () => {
                        setFileBusy(k);
                        try { await downloadAndOpen({ path: customersExportPath, params: { kind: k }, filename: `customers-${k}.xlsx`, mime: XLSX, title: tr(label) }); setSheetOpen(false); } catch (e) { showToast(e?.safe ? e.message : apiError(e)); } finally { setFileBusy(''); }
                    }} accessibilityRole="button" style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: border, opacity: fileBusy && fileBusy !== k ? 0.4 : 1 }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr(label)}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr(hint)}</Text>
                        </View>
                        <Ionicons name={fileBusy === k ? 'hourglass-outline' : 'download-outline'} size={22} color={primary} />
                    </Pressable>
                ))}
            </Sheet>
            <FlatList
                data={tag === 'blocked' ? blockedShown : (items || [])}
                keyExtractor={(u) => String(u.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 32 }}
                ListHeaderComponent={header}
                renderItem={({ item: u }) => {
                    if (tag === 'blocked') return <BlockedCard b={u} busy={busyId === u.id} onUnblock={unblock} />;
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
                                    {tg ? <Text style={{ color: tg.color, backgroundColor: alpha(tg.color, 0.12), fontSize: 10, fontWeight: '900', marginLeft: 8, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8, overflow: 'hidden' }}>{u.vip && u.tag !== 'vip' ? tr('VIP · {label}', { label: tg.label }) : tg.label}</Text> : null}
                                </View>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{u.orders !== undefined ? `${sinceLine(u)} · ${usualLine(u)}` : tr('{phone} · joined {ago}', { phone: u.phone, ago: ago(u.createdAt) })}</Text>
                            </View>
                            {canRemind && (u.tag === 'slipping' || u.tag === 'lost') ? (
                                <Pressable onPress={() => setRemind(u)} hitSlop={8} style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, borderWidth: 1, borderColor: primary }}>
                                    <Text style={{ color: primary, fontWeight: '800', fontSize: 12 }}>{tr('Remind')}</Text>
                                </Pressable>
                            ) : <Ionicons name="chevron-forward" size={18} color={muted} />}
                        </Pressable>
                    );
                }}
                ListEmptyComponent={tag === 'blocked' ? (blocked === null ? <ListShimmer rows count={3} /> : <Empty icon="checkmark-circle-outline" title={tr('No blocked customers')} hint={tr('Nobody is blocked right now.')} />) : items === null ? <ListShimmer rows count={6} /> : err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : <Empty icon="people-outline" title={q ? tr('No customer found') : tag === 'all' ? tr('No customers yet') : tr('No {v1} customers', { v1: TAGS[tag].label.toLowerCase() })} hint={q ? tr('Try another name or number.') : tag === 'all' ? tr('Customers appear here when they sign in to your app.') : tr('Good news: nobody is here right now.')} />}
                ListFooterComponent={tag === 'blocked' ? null : more ? <Pressable onPress={() => { setLoadingMore(true); load(page + 1, q, tag); }} style={{ padding: 18, alignItems: 'center' }}>{loadingMore ? <LineShimmer width={90} height={16} /> : <Text style={{ color: primary, fontWeight: '800' }}>{tr('Show more')}</Text>}</Pressable> : null}
            />
            {remind ? <RemindSheet visible customer={remind} onClose={() => setRemind(null)} onSent={() => load(1, q, tag)} /> : null}
        </View>
    );
}
