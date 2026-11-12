// Customers of the shop: filter by how they are doing (slipping, lost, new, regular, loyal, VIP), search by name or phone.
// Tap one for his page; "Remind" on a row sends him a friendly nudge (push and his in-app inbox).
import { usePlanHas } from '../../utils/owners/menuFlags';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, FlatList, Pressable, ScrollView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
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
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Hero, HeroBtn, GlassStat } from '../../components/owners/RiderDesk';
import { ago } from '../../utils/owners/riderRules';
import { TAGS, TAG_ORDER, usualLine, sinceLine } from '../../utils/owners/customerTags';
import { LineShimmer, ListShimmer } from '../../components/owners/shimmer';
import { tr, tl } from '../../i18n';
import { UpgradeNote } from '../../components/owners/PlanLock';

// One customer as a card on a computer: a round letter, the name and a tag (new, regular, slipping...), when they came and what they usually order, and Remind where it helps.
function CustomerTile({ u, onOpen, onRemind }) {
    const { text, muted, surface, border, primary } = useBrand();
    const tg = TAGS[u.tag];
    const canRemind = u.id && u.orders > 0 && (u.tag === 'slipping' || u.tag === 'lost');
    const c = tg?.color || primary;
    return (
        <Pressable onPress={onOpen} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, padding: 16, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: alpha(c, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: c, fontWeight: '900', fontSize: 22 }}>{personName(u).replace(/^Customer\s*/, '').charAt(0).toUpperCase() || '?'}</Text>
                </View>
                <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 16.5 }} numberOfLines={1}>{personName(u)}</Text>
                    {tg ? <View style={{ alignSelf: 'flex-start', marginTop: 5, paddingHorizontal: 10, height: 24, borderRadius: 12, backgroundColor: alpha(tg.color, 0.14), justifyContent: 'center' }}><Text style={{ color: tg.color, fontSize: 11.5, fontWeight: '900' }}>{tr(tg.label)}</Text></View> : null}
                </View>
            </View>
            <Text style={{ color: muted, fontSize: 13, marginTop: 12, lineHeight: 19 }} numberOfLines={2}>{u.orders !== undefined ? `${sinceLine(u)} · ${usualLine(u)}` : (u.phone || '')}</Text>
            {canRemind ? (
                <Pressable onPress={onRemind} style={({ hovered }) => ({ alignSelf: 'flex-start', marginTop: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 36, borderRadius: 18, backgroundColor: hovered ? primary : alpha(primary, 0.12), cursor: 'pointer' })}>
                    {({ hovered }) => (<><Ionicons name="paper-plane-outline" size={15} color={hovered ? '#FFFFFF' : primary} /><Text style={{ color: hovered ? '#FFFFFF' : primary, fontWeight: '800', fontSize: 13, marginLeft: 6 }}>{tr('Remind')}</Text></>)}
                </Pressable>
            ) : null}
        </Pressable>
    );
}

export default function OwnerCustomersScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, filter chips and the customers as cards three across
    const gcols = useGridCols(3, 300);   // fewer, wider cards in a narrow window
    const autopilotOk = usePlanHas('customPush');   // Autopilot is Pro
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

    useEffect(() => { if (tag === 'blocked') return; if (!desk) setItems(null); load(1, q, tag); }, [q, tag, load]);
    // the numbers on the chips, and again when we come back from a customer's page
    useFocusEffect(useCallback(() => { fetchCustomerInsights({ limit: 1 }).then((r) => setCounts(r.counts)).catch(() => { }); }, []));
    const onType = (v) => { setTyped(v); clearTimeout(t.current); t.current = setTimeout(() => setQ(v.trim()), 400); };

    const chips = [['all', tr('Everyone')], ...TAG_ORDER.map((k) => [k, tr(TAGS[k].label)]), ['blocked', tr('Blocked')]];
    const deskHeader = (
        <View style={{ paddingBottom: 6 }}>
            <Hero icon="people" title={tr('Your customers')} subtitle={tr('Who orders from you, how often, and who has gone quiet.')}
                right={<>
                    {autopilotOk ? <HeroBtn label={tr('Autopilot')} icon="rocket-outline" onPress={() => nav.navigate('OwnerAutopilot')} /> : null}
                    <HeroBtn label={tr('Excel')} icon="download-outline" solid onPress={() => setSheetOpen(true)} />
                </>}>
                <View style={{ flexDirection: 'row', marginTop: 18 }}>
                    {TAG_ORDER.slice(0, 4).map((k) => <GlassStat key={k} label={tr(TAGS[k].label)} value={counts && counts[k] != null ? String(counts[k]) : '–'} icon="person-outline" />)}
                </View>
            </Hero>
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 }}>
                <View style={{ width: 340 }}><Field value={typed} onChangeText={onType} placeholder={tr('Search by name or phone')} maxLength={40} style={{ minHeight: 44, borderRadius: 22, paddingHorizontal: 18 }} /></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1, marginLeft: 14 }}>
                    {chips.map(([k, label]) => {
                        const on = tag === k;
                        return (
                            <Pressable key={k} onPress={() => setTag(k)} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, height: 40, borderRadius: 20, marginRight: 8, borderWidth: 1.5, borderColor: on ? primary : hovered ? alpha(primary, 0.55) : border, backgroundColor: on ? primary : hovered ? alpha(primary, 0.07) : 'transparent', cursor: 'pointer' })}>
                                <Text style={{ color: on ? '#FFFFFF' : text, fontWeight: '800', fontSize: 13.5 }}>{label}</Text>
                                {counts && counts[k] != null && k !== 'all' ? <Text style={{ color: on ? '#FFFFFF' : muted, fontWeight: '900', fontSize: 12.5, marginLeft: 7 }}>{counts[k]}</Text> : null}
                            </Pressable>
                        );
                    })}
                </ScrollView>
            </View>
            {tag === 'blocked' ? <Text style={{ color: muted, fontSize: 13, paddingHorizontal: 20, marginBottom: 6 }}>{tr('Customers you blocked: when, why, and the order it was about. You can unblock them here.')}</Text> : null}
        </View>
    );
    const header = (
        <View style={{ paddingBottom: 6 }}>
            <View style={{ paddingHorizontal: 16, paddingBottom: 10, flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1 }}><Field value={typed} onChangeText={onType} placeholder={tr('Search by name or phone')} maxLength={40} style={{ minHeight: 44 }} /></View>
                <FunnelButton count={tag === 'all' ? 0 : 1} onPress={() => setFiltering(true)} style={{ marginLeft: 8 }} />
            </View>
            {tag !== 'all' ? <Text style={{ color: primary, fontWeight: '800', paddingHorizontal: 16, marginBottom: 4 }}>{tag === 'blocked' ? tr('Blocked') : tr(TAGS[tag]?.label || tag)}</Text> : null}
            {tag === 'blocked' ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginTop: 8 }}>{tr('Customers you blocked: when, why, and the order it was about. You can unblock them here.')}</Text> : tag !== 'all' ? <Text style={{ color: muted, fontSize: 12, paddingHorizontal: 16, marginTop: 8 }}>{TAGS[tag].hint}</Text> : null}
            {!autopilotOk ? <UpgradeNote feature="customPush" text={tr('Reminders that bring customers back, by themselves')} /> : null}
            {autopilotOk ? (
            <Pressable onPress={() => nav.navigate('OwnerAutopilot')} style={{ marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, backgroundColor: alpha(primary, 0.1), flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="rocket" size={20} color={primary} />
                <Text style={{ flex: 1, color: text, fontWeight: '800', marginLeft: 10 }}>{tr('Autopilot: reminders that go out by themselves')}</Text>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
            ) : null}
        </View>
    );

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Customers')} right={<Pressable onPress={() => setSheetOpen(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel={tr('Download Excel')} style={{ padding: 6 }}><Ionicons name="download-outline" size={24} color={primary} /></Pressable>} />
            <FilterPopup visible={filtering} onClose={() => setFiltering(false)} title={tr('Filter customers')} activeCount={tag === 'all' ? 0 : 1} onClear={() => setTag('all')}
                sections={[{ key: 'tag', title: 'Show', value: tag, onChange: setTag, options: [['all', 'Everyone'], ...TAG_ORDER.map((k) => [k, `${tr(TAGS[k].label)}${counts && counts[k] != null ? ` ${counts[k]}` : ''}`]), ['blocked', `${tr('Blocked')}${blocked ? ` ${blocked.length}` : ''}`]] }]} />
            <Sheet visible={sheetOpen} onClose={() => !fileBusy && setSheetOpen(false)} title={tr('Download customers as Excel')}>
                <Text style={{ color: muted, marginBottom: 10 }}>{tr('Choose a list. The sheet has orders, spend, most ordered food, the time they usually order and more.')}</Text>
                {[['all', tl('All customers'), tl('Everyone who ordered, newest first')], ['repeat', tl('Most repeating customers'), tl('Ordered 2 or more times, most orders first')], ['valuable', tl('Most valuable customers'), tl('Highest spend first')], ['recent', tl('Recent customers'), tl('Ordered in the last 30 days')], ['lapsed', tl('Lapsed customers'), tl('No order for 30 days or more, biggest spenders first')]].map(([k, label, hint]) => (
                    <Pressable key={k} disabled={!!fileBusy} onPress={async () => {
                        setFileBusy(k);
                        try { await downloadAndOpen({ path: customersExportPath, params: { kind: k }, filename: `customers-${k}.xlsx`, mime: XLSX, title: tr(label) }); setSheetOpen(false); } catch (e) { showToast(e?.safe ? e.message : apiError(e)); } finally { setFileBusy(''); }
                    }} accessibilityRole="button" style={({ hovered }) => ({ ...(hovered && !fileBusy ? { backgroundColor: alpha(primary, 0.07), borderRadius: 14, marginHorizontal: -10, paddingHorizontal: 10, cursor: 'pointer' } : null), flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderTopWidth: 0.5, borderTopColor: hovered && !fileBusy ? 'transparent' : border, opacity: fileBusy && fileBusy !== k ? 0.4 : 1 })}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '800', fontSize: 15 }}>{tr(label)}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr(hint)}</Text>
                        </View>
                        <Ionicons name={fileBusy === k ? 'hourglass-outline' : 'download-outline'} size={22} color={primary} />
                    </Pressable>
                ))}
            </Sheet>
            <View style={desk ? { flex: 1, width: '100%', maxWidth: 1240, alignSelf: 'center' } : { flex: 1 }}>
            <FlatList
                key={desk ? `g${gcols}` : 'g1'}
                numColumns={desk ? gcols : 1}
                data={tag === 'blocked' ? blockedShown : (items || [])}
                keyExtractor={(u) => String(u.id)}
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 32 }}
                ListHeaderComponent={desk ? deskHeader : header}
                renderItem={({ item: u }) => {
                    if (desk) return <View style={{ width: `${100 / gcols}%`, padding: 8 }}>{tag === 'blocked' ? <BlockedCard b={u} busy={busyId === u.id} onUnblock={unblock} /> : <CustomerTile u={u} onOpen={() => nav.navigate('OwnerCustomer', { id: String(u.id) })} onRemind={() => setRemind(u)} />}</View>;
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
            </View>
            {remind ? <RemindSheet visible customer={remind} onClose={() => setRemind(null)} onSent={() => load(1, q, tag)} /> : null}
        </View>
    );
}
