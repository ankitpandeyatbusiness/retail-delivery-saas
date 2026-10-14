import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, ListRow } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { Loading, Empty, Sheet } from '../../components/feedback';
import { Field } from '../../components/inputs';
import { searchScreens } from '../../utils/screenIndex';
import { useShopsStore } from '../../store/useShopsStore';
import { searchAll } from '../../api/insightsApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateTime, titleCase } from '../../utils/format';

// One box to find a shop, an order (by number or customer phone), a person (by phone) or a rent invoice.
export default function SearchScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [q, setQ] = useState('');
    const [r, setR] = useState(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const seq = useRef(0);
    const shops = useShopsStore((st) => st.items);
    const shopsLoaded = useShopsStore((st) => st.loaded);
    const [pick, setPick] = useState(null);       // a screen that needs a shop: waiting for the shop to be chosen
    const [shopQ, setShopQ] = useState('');
    const screens = useMemo(() => searchScreens(q), [q]);

    useEffect(() => { if (!shopsLoaded) useShopsStore.getState().load(); }, [shopsLoaded]);

    // go to a screen: above the tabs, or inside one tab's stack
    const goTo = (e, shop) => {
        const params = shop ? { shopId: String(shop._id), name: shop.name } : undefined;
        if (e.stack === 'root') nav.navigate(e.screen, params);
        else nav.navigate('Admin', { screen: e.stack, params: { screen: e.screen, ...(params ? { params } : {}) } });
    };
    const open = (e) => {
        if (e.scope !== 'shop') { goTo(e); return; }
        if (shops.length === 1) { goTo(e, shops[0]); return; }
        setShopQ('');
        setPick(e);
    };
    const shopList = shops.filter((x) => !shopQ.trim() || x.name.toLowerCase().includes(shopQ.trim().toLowerCase()));

    useEffect(() => {
        const text = q.trim();
        if (text.length < 2) { setR(null); setError(''); return undefined; }
        const id = setTimeout(async () => {
            const mine = ++seq.current;
            setBusy(true);
            try {
                const res = await searchAll(text);
                if (mine === seq.current) { setR(res); setError(''); }
            } catch (e) { if (mine === seq.current) setError(errMsg(e)); } finally { if (mine === seq.current) setBusy(false); }
        }, 350);
        return () => clearTimeout(id);
    }, [q]);

    const inShops = (screen, params) => nav.navigate('Admin', { screen: 'ShopsTab', params: { screen, params } });
    const empty = r && !screens.length && !r.shops.length && !r.orders.length && !r.people.length && !r.invoices.length;

    return (
        <Screen title="Search" subtitle="Shops, orders, people, invoices">
            <SearchBar value={q} onChangeText={setQ} placeholder="Shop name, order no, phone, invoice no" />
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>Type a shop name, an order number, a phone or an invoice number. You can also type a setting or a screen, like "delivery fee", "gst" or "holiday".</Text>
            {screens.length ? (
                <>
                    <SectionTitle section="settings">Screens and settings</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {screens.map((e, i) => (
                            <ListRow
                                key={`${e.stack}-${e.screen}`}
                                section={e.section}
                                icon={e.icon}
                                title={e.title}
                                subtitle={`${e.where}${e.scope === 'shop' ? ' · asks which shop' : ''}`}
                                onPress={() => open(e)}
                                last={i === screens.length - 1}
                            />
                        ))}
                    </Card>
                </>
            ) : null}
            {busy && !r ? <Loading label="Searching" /> : null}
            {error ? <Text style={{ color: t.danger, marginTop: spacing.md }}>{error}</Text> : null}
            {empty ? <Empty icon="search" title="Nothing found" hint="Check the spelling or the number." /> : null}

            {r?.shops.length ? (
                <>
                    <SectionTitle section="shops">Shops</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {r.shops.map((s, i) => (
                            <ListRow key={s.id} section="shops" icon="shops" title={s.name} subtitle={`${s.slug} · ${titleCase(s.billingState || 'free')}${s.status === 'suspended' ? ' · suspended' : ''}`}
                                onPress={() => inShops('ShopDetail', { shopId: String(s.id), name: s.name })} last={i === r.shops.length - 1} />
                        ))}
                    </Card>
                </>
            ) : null}

            {r?.orders.length ? (
                <>
                    <SectionTitle section="orders">Orders</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {r.orders.map((o, i) => (
                            <ListRow key={o.id} section="orders" icon="orders" title={`#${o.orderNo} · ${o.shop || 'Shop'}`}
                                subtitle={`${titleCase(o.status)} · ${rupeesFromPaise(o.totalPaise)} · ${dateTime(o.at)}`}
                                onPress={() => nav.navigate('Admin', { screen: 'OrdersTab', params: { screen: 'OrderDetail', params: { orderId: String(o.id), orderNo: o.orderNo } } })}
                                last={i === r.orders.length - 1} />
                        ))}
                    </Card>
                </>
            ) : null}

            {r?.people.length ? (
                <>
                    <SectionTitle section="people">People</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {r.people.map((p, i) => (
                            <ListRow key={p.id} section="people" icon="user" title={`${p.name || 'No name'} · ${p.phone}`} subtitle={`${titleCase(p.role)} at ${p.shop || 'a shop'}`}
                                onPress={() => inShops('ShopUserDetail', { shopId: String(p.tenantId), userId: String(p.id), shopName: p.shop })}
                                last={i === r.people.length - 1} />
                        ))}
                    </Card>
                </>
            ) : null}

            {r?.invoices.length ? (
                <>
                    <SectionTitle section="money">Rent invoices</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        {r.invoices.map((inv, i) => (
                            <ListRow key={inv.id} section="money" icon="receipt" title={inv.invoiceNo} subtitle={`${inv.shop || 'Shop'} · ${rupeesFromPaise(inv.totalPaise)} · ${titleCase(inv.status)}`}
                                onPress={() => nav.navigate('Admin', { screen: 'MoneyTab', params: { screen: 'InvoiceDetail', params: { invoiceId: String(inv.id), invoiceNo: inv.invoiceNo } } })}
                                last={i === r.invoices.length - 1} />
                        ))}
                    </Card>
                </>
            ) : null}
            <Sheet visible={!!pick} onClose={() => setPick(null)} title={pick ? `${pick.title}: which shop?` : ''}>
                <Field label="" value={shopQ} onChangeText={setShopQ} placeholder="Find a shop" autoCapitalize="none" />
                <View style={{ maxHeight: 360 }}>
                    {shopList.slice(0, 12).map((x) => (
                        <ListRow key={x._id} section="shops" icon="shops" title={x.name} subtitle={x.slug} onPress={() => { const e = pick; setPick(null); goTo(e, x); }} />
                    ))}
                    {!shopList.length ? <Text style={{ color: t.muted, padding: spacing.md }}>No shop matches.</Text> : null}
                </View>
            </Sheet>
        </Screen>
    );
}
