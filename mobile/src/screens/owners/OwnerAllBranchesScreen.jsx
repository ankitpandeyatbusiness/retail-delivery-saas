// All branches (brand owner only): today's or the last days' orders and sales for every branch side by side, 
// and the newest orders of all branches. Read only: to change something, switch to that branch (tap its row).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, SectionTitle, Stat, Empty, Button, money } from '../../components/owners/ui';
import { StatShimmer } from '../../components/owners/shimmer';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { useNavigation } from '@react-navigation/native';
import { fetchBrandOverview, fetchBrandOrders, fetchBrandCustomers, fetchBrandComplaints, fetchBrandReviews } from '../../api/owners/brandApi';
import { switchBranch } from '../../utils/common/switchBranch';
import { getSlug } from '../../utils/common/branch';
import { tr } from '../../i18n';

const STATUS = { placed: 'New', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready', out_for_delivery: 'On the way', delivered: 'Delivered', cancelled: 'Cancelled', undelivered: 'Not delivered' };

export default function OwnerAllBranchesScreen() {
    const { background, text, muted, error, primary, border } = useBrand();
    const [range, setRange] = useState('today');
    const [ov, setOv] = useState(null);
    const [orders, setOrders] = useState(null);
    const nav = useNavigation();
    const [cust, setCust] = useState(null);
    const [comp, setComp] = useState(null);
    const [rev, setRev] = useState(null);
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        setOv(null); setErr('');
        try { setOv(await fetchBrandOverview(range)); } catch (e) { setErr(tr('Could not load.')); }
    }, [range]);
    useEffect(() => { load(); }, [load]);
    useEffect(() => {
        fetchBrandOrders({ limit: 15 }).then(setOrders).catch(() => setOrders({ items: [] }));
        fetchBrandComplaints({ status: 'open', limit: 5 }).then(setComp).catch(() => setComp(null));
    }, []);
    // customers and ratings follow the chosen range
    useEffect(() => {
        const r = range === 'today' ? '7' : range;
        fetchBrandCustomers(r).then(setCust).catch(() => setCust(null));
        fetchBrandReviews({ range: r, limit: 5, low: 1 }).then(setRev).catch(() => setRev(null));
    }, [range]);

    const open = async (b) => {
        if (b.slug === getSlug()) { showToast(tr('You are already in {name}.', { name: b.name })); return; }
        const yes = await ask({ title: tr('Open {name}?', { name: b.name }), message: tr('The app restarts and opens {name}.', { name: b.name }), confirmText: tr('Open') });
        if (!yes) return;
        try { await switchBranch(b.slug); } catch (e) { showToast(tr('Could not switch. Please try again.')); }
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('All branches')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['today', tr('Today')], ['7', tr('7 days')], ['30', tr('30 days')]]} value={range} onChange={setRange} />
                </View>
                {!ov && !err ? <StatShimmer /> : null}
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {ov ? (
                    <>
                        <Card>
                            <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>{tr('All branches together')}</Text>
                            <Text style={{ color: text, fontSize: 34, fontWeight: '900', marginTop: 2 }}>{money(ov.totals.sales)}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 12 }}>
                                <Stat label={tr('Orders')} value={String(ov.totals.orders)} />
                                <Stat label={tr('Delivered')} value={String(ov.totals.delivered)} />
                                <Stat label={tr('On now')} value={String(ov.totals.activeNow)} />
                            </View>
                        </Card>
                        <SectionTitle title={tr('Branches')} />
                        {ov.branches.map((b) => (
                            <Card key={b.slug} onPress={() => open(b)}>
                                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16, flex: 1 }} numberOfLines={1}>{b.name}</Text>
                                    <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{money(b.sales)}</Text>
                                </View>
                                <Text style={{ color: muted, marginTop: 2 }}>
                                    {[b.city, tr('{n} orders', { n: b.orders }), b.activeNow ? tr('{n} on now', { n: b.activeNow }) : null, b.cancelled ? tr('{n} cancelled', { n: b.cancelled }) : null].filter(Boolean).join(' · ')}
                                </Text>
                                {b.slug === getSlug() ? <Text style={{ color: primary, fontWeight: '800', marginTop: 4 }}>{tr('You are here')}</Text> : null}
                            </Card>
                        ))}
                    </>
                ) : null}

                {cust ? (
                    <>
                        <SectionTitle title={tr('Customers')} />
                        <Card>
                            <View style={{ flexDirection: 'row' }}>
                                <Stat label={tr('People')} value={String(cust.totals.people)} hint={cust.totals.inMoreThanOneBranch ? tr('{n} use more than one branch', { n: cust.totals.inMoreThanOneBranch }) : undefined} />
                                <Stat label={tr('New')} value={String(cust.totals.newInRange)} />
                                <Stat label={tr('Ordered')} value={String(cust.totals.orderedInRange)} />
                            </View>
                            {cust.branches.map((b) => <Text key={b.slug} style={{ color: muted, marginTop: 6 }}>{tr('{name}: {n} customers, {fresh} new', { name: b.name, n: b.customers, fresh: b.newInRange })}</Text>)}
                        </Card>
                    </>
                ) : null}

                {comp ? (
                    <>
                        <SectionTitle title={tr('Open complaints')} />
                        <Card>
                            {comp.openByBranch.map((b) => <Text key={b.slug} style={{ color: b.open ? error : muted, fontWeight: b.open ? '800' : '600', marginTop: 2 }}>{tr('{name}: {n} open', { name: b.name, n: b.open })}</Text>)}
                        </Card>
                        {comp.items.map((c) => (
                            <Pressable key={c.id} onPress={() => c.branch && open({ slug: c.branch.slug, name: c.branch.name })} style={{ marginHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: border }}>
                                <Text style={{ color: text, fontWeight: '800' }} numberOfLines={1}>{`${c.branch ? c.branch.name : ''} · #${c.orderNo || c.bulkCode || ''}`}</Text>
                                <Text style={{ color: muted }} numberOfLines={2}>{c.text}</Text>
                            </Pressable>
                        ))}
                    </>
                ) : null}

                {rev && rev.total.count ? (
                    <>
                        <SectionTitle title={tr('Dish ratings')} />
                        <Card>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 18 }}>{tr('{avg} stars from {n} ratings', { avg: rev.total.average, n: rev.total.count })}</Text>
                            {rev.branches.map((b) => <Text key={b.slug} style={{ color: muted, marginTop: 4 }}>{b.count ? tr('{name}: {avg} stars ({n}), {low} low', { name: b.name, avg: b.average, n: b.count, low: b.low }) : tr('{name}: no ratings', { name: b.name })}</Text>)}
                        </Card>
                        {rev.items.map((r) => (
                            <View key={r.id} style={{ marginHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: border }}>
                                <Text style={{ color: text, fontWeight: '800' }} numberOfLines={1}>{`${r.rating}★  ${r.dish || ''} · ${r.branch ? r.branch.name : ''}`}</Text>
                                {r.comment ? <Text style={{ color: muted }} numberOfLines={2}>{r.comment}</Text> : null}
                            </View>
                        ))}
                    </>
                ) : null}

                <SectionTitle title={tr('Newest orders')} />
                {orders && !orders.items.length ? <Empty icon="receipt-outline" title={tr('No orders yet')} /> : null}
                {orders ? orders.items.map((o) => (
                    <Pressable key={o.id} onPress={() => o.branch && open({ slug: o.branch.slug, name: o.branch.name })} style={{ marginHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: border }}>
                        <View style={{ flexDirection: 'row' }}>
                            <Text style={{ color: text, fontWeight: '800', flex: 1 }}>{`#${o.orderNo}  ${o.branch ? o.branch.name : ''}`}</Text>
                            <Text style={{ color: text, fontWeight: '800' }}>{money(o.total)}</Text>
                        </View>
                        <Text style={{ color: muted, fontSize: 12 }}>{`${tr(STATUS[o.status] || o.status)} · ${new Date(o.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}</Text>
                    </Pressable>
                )) : null}
            </ScrollView>
        </View>
    );
}
