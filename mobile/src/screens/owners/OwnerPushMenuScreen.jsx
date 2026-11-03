// Send dishes of THIS branch to other branches (brand owner only). Each branch keeps its own menu: a sent dish is created there if it is
// missing, or its words and pictures are updated if it is already there. Stock, "sold out" and a dish the branch hid are never touched.
// Prices stay each branch's own, unless you choose to update them here.
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Chips, Button, SectionTitle, Empty, money } from '../../components/owners/ui';
import { ask } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { useMenuStore } from '../../store/owners/useMenuStore';
import { useBrandStore } from '../../store/owners/useBrandStore';
import { pushMenu, pushExtras } from '../../api/owners/brandApi';
import { coupons, banners, collections } from '../../api/owners/shopApi';
import { apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';

const KINDS = [['dishes', tr('Dishes')], ['coupons', tr('Coupons')], ['banners', tr('Banners')], ['collections', tr('Collections')]];
const LIST = { coupons, banners, collections };
const labelOf = (kind, it) => (kind === 'coupons' ? `${it.code} · ${it.discountType === 'percent' ? `${it.discountValue}%` : `₹${it.discountValue}`}` : it.title || '');
const PRICES = [['keep', tr('Keep their prices')], ['untouched', tr('Update if unchanged')], ['all', tr('Set all to mine')]];

export default function OwnerPushMenuScreen() {
    const { background, text, muted, primary, border } = useBrand();
    const products = useMenuStore((s) => s.products);
    const categories = useMenuStore((s) => s.categories);
    const loading = useMenuStore((s) => s.loading);
    const me = useBrandStore((s) => s.me);
    const [picked, setPicked] = useState({});        // productId -> true
    const [target, setTarget] = useState('all');     // 'all' or a branch slug
    const [prices, setPrices] = useState('keep');
    const [busy, setBusy] = useState(false);
    const [kind, setKind] = useState('dishes');   // dishes | coupons | banners | collections
    const [extra, setExtra] = useState(null);      // the list of coupons, banners or collections of this branch

    useEffect(() => { useMenuStore.getState().load({ quiet: true }); useBrandStore.getState().load(); }, []);

    const others = (me && me.branches ? me.branches : []).filter((b) => b.slug !== me.current);
    const groups = useMemo(() => {
        const by = new Map();
        for (const p of products) {
            const k = String(p.categoryId);
            if (!by.has(k)) by.set(k, []);
            by.get(k).push(p);
        }
        return categories.map((c) => ({ id: String(c._id), name: c.name, items: by.get(String(c._id)) || [] })).filter((g) => g.items.length);
    }, [products, categories]);
    useEffect(() => {
        setPicked({});
        if (kind === 'dishes') { setExtra(null); return; }
        setExtra(null);
        LIST[kind].list({ limit: 100 }).then((r) => setExtra(r.items || [])).catch(() => setExtra([]));
    }, [kind]);
    const count = Object.values(picked).filter(Boolean).length;
    const toggle = (id) => setPicked((x) => ({ ...x, [id]: !x[id] }));
    const toggleGroup = (g) => {
        const all = g.items.every((p) => picked[p._id]);
        setPicked((x) => ({ ...x, ...Object.fromEntries(g.items.map((p) => [p._id, !all])) }));
    };

    const send = async () => {
        const where = target === 'all' ? tr('all other branches') : (others.find((b) => b.slug === target) || {}).name;
        const yes = await ask({
            title: tr('Send {n} items?', { n: count }),
            message: tr('To {where}. Their stock and hidden dishes are not touched.', { where }),
            confirmText: tr('Send'),
        });
        if (!yes) return;
        setBusy(true);
        try {
            const chosen = Object.keys(picked).filter((id) => picked[id]);
            const toSlugs = target === 'all' ? 'all' : [target];
            const r = kind === 'dishes' ? await pushMenu({ productIds: chosen, toSlugs, prices }) : await pushExtras({ kind, ids: chosen, toSlugs });
            showToast(tr('Done: {created} added, {updated} updated', { created: r.created, updated: r.updated }));
            if (r.conflicts) showToast(tr('{n} skipped: the branch already has a different coupon with that code.', { n: r.conflicts }));
            setPicked({});
        } catch (e) { showToast(apiError(e, tr('Could not send the dishes.'))); } finally { setBusy(false); }
    };

    if (me && others.length === 0) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Send dishes to branches')} />
                <Empty icon="git-network-outline" title={tr('No other branch yet')} />
            </View>
        );
    }

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Send dishes to branches')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 120 }}>
                <SectionTitle title={tr('What to send')} />
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={KINDS} value={kind} onChange={setKind} />
                </View>
                <SectionTitle title={tr('Send to')} />
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['all', tr('All branches')], ...others.map((b) => [b.slug, b.name])]} value={target} onChange={setTarget} />
                </View>
                {kind === 'dishes' ? <SectionTitle title={tr('Prices')} /> : null}
                {kind === 'dishes' ? <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={PRICES} value={prices} onChange={setPrices} />
                    <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>
                        {prices === 'keep' ? tr('Each branch keeps its own prices. New dishes come with your price.')
                            : prices === 'untouched' ? tr('A branch gets your new price only if it never changed that price itself.')
                                : tr('Every chosen branch gets your prices.')}
                    </Text>
                </View> : null}

                {kind !== 'dishes' ? (
                    <>
                        <SectionTitle title={KINDS.find((k) => k[0] === kind)[1]} />
                        {extra && !extra.length ? <Empty icon="pricetags-outline" title={tr('Nothing here yet')} /> : null}
                        {extra === null ? <Text style={{ color: muted, marginHorizontal: 16 }}>{tr('Loading...')}</Text> : null}
                        {extra && extra.length ? (
                            <Card>
                                {extra.map((it, i) => (
                                    <Pressable key={it._id} onPress={() => toggle(it._id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: i ? 1 : 0, borderTopColor: border }}>
                                        <Ionicons name={picked[it._id] ? 'checkbox' : 'square-outline'} size={22} color={picked[it._id] ? primary : muted} />
                                        <Text style={{ color: text, fontWeight: '700', marginLeft: 10, flex: 1 }} numberOfLines={1}>{labelOf(kind, it)}</Text>
                                    </Pressable>
                                ))}
                            </Card>
                        ) : null}
                    </>
                ) : null}

                {kind === 'dishes' ? <SectionTitle title={tr('Dishes')} /> : null}
                {kind === 'dishes' && loading && !products.length ? <Text style={{ color: muted, marginHorizontal: 16 }}>{tr('Loading...')}</Text> : null}
                {kind === 'dishes' ? groups.map((g) => (
                    <Card key={g.id}>
                        <Pressable onPress={() => toggleGroup(g)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                            <Text style={{ color: text, fontWeight: '900', flex: 1 }}>{g.name}</Text>
                            <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{g.items.every((p) => picked[p._id]) ? tr('Clear') : tr('Select all')}</Text>
                        </Pressable>
                        {g.items.map((p) => (
                            <Pressable key={p._id} onPress={() => toggle(p._id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderTopWidth: 1, borderTopColor: border }}>
                                <Ionicons name={picked[p._id] ? 'checkbox' : 'square-outline'} size={22} color={picked[p._id] ? primary : muted} />
                                <Text style={{ color: text, fontWeight: '700', marginLeft: 10, flex: 1 }} numberOfLines={1}>{p.name}</Text>
                                <Text style={{ color: muted }}>{money(p.price)}</Text>
                            </Pressable>
                        ))}
                    </Card>
                )) : null}
            </ScrollView>
            <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: background, borderTopWidth: 1, borderTopColor: border }}>
                <Button label={count ? tr('Send {n} items', { n: count }) : tr('Choose what to send')} onPress={send} disabled={!count} busy={busy} />
            </View>
        </View>
    );
}
