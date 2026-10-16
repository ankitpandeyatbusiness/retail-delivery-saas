// The shop menu: everything that is not one of the five tabs. It is the side menu opened by the hamburger at the top
// left of every tab (components/owners/OwnerDrawer.jsx); the same list is also available as a full page (ShopHub).
import React, { useCallback, useState } from 'react';
import { View, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import AppearanceSwitch from '../../components/owners/AppearanceSwitch';
import { PageHeader, Card, Row, SectionTitle, Sheet, Button, Pill, Chips } from '../../components/owners/ui';
import { Label } from '../../components/owners/menuBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { fetchSettings, setBusy, apiError } from '../../api/owners/shopApi';
import { BUSY_EXTRA, BUSY_FOR } from '../../utils/owners/settingsRules';
import { clockTime } from '../../utils/owners/orderFlow';
import { showToast } from '../../components/customers/shop';
import { useAuthStore } from '../../store/common/useAuthStore';
import { ask } from '../../components/common/dialog';

// [icon, title, subtitle, route]
const GROUPS = [
    ['Menu', [
        ['list', 'Categories', 'Order, pictures and opening hours of each section', 'OwnerCategories'],
        ['albums', 'Collections', 'Festival and combo strips on the home screen', 'OwnerCollections'],
    ]],
    ['Customers and care', [
        ['people', 'Customers', 'Your customers, their orders, allow cash on delivery', 'OwnerCustomers'],
        ['chatbubble-ellipses', 'Complaints', 'Reply to and resolve complaints', 'OwnerComplaints'],
        ['star', 'Reviews', 'What customers say about your food and delivery', 'OwnerReviews'],
        ['megaphone', 'Messages', 'Send a message to customers or riders', 'OwnerMessages'],
    ]],
    ['Offers', [
        ['pricetag', 'Coupons', 'Discount codes', 'OwnerCoupons'],
        ['images', 'Banners', 'Pictures on the home screen', 'OwnerBanners'],
    ]],
    ['Money', [
        ['trophy', 'Popular items', 'What sells most: last 7 days, 30 days, 3 months', 'OwnerPopular'],
        ['swap-vertical', 'Transactions and bills', 'Every payment, year by year and month by month', 'OwnerTransactions'],
    ]],
    ['Shop', [
        ['time', 'Opening hours', 'Weekly hours and holidays', 'OwnerHours'],
        ['navigate', 'Delivery area and fees', 'Pin, distance, delivery fee, packaging, tips', 'OwnerDelivery'],
        ['settings', 'Shop settings', 'Phone, address, SMS alerts', 'OwnerShopSettings'],
        ['list-circle', 'Activity log', 'Who changed what', 'OwnerActivity'],
    ]],
];

// Busy mode: the kitchen is rushed, customers see a longer wait for a while. It ends by itself.
function BusySheet({ visible, busy, onClose, onChanged }) {
    const [extra, setExtra] = useState(15);
    const [work, setWork] = useState(false);
    const go = async (body) => {
        setWork(true);
        try {
            const r = await setBusy(body);
            onChanged(r.busy);
            showToast(r.busy ? 'Busy mode is on' : 'Back to normal');
            onClose();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setWork(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title="Busy mode">
            <Label hint="Customers see a longer waiting time, so nobody expects food too soon. It ends by itself.">How much longer</Label>
            <Chips options={BUSY_EXTRA} value={extra} onChange={setExtra} style={{ marginTop: 0 }} />
            <Label>For how long</Label>
            {BUSY_FOR.map(([id, label, when]) => (
                <View key={id} style={{ marginBottom: 8 }}><Button label={label} kind="ghost" disabled={work} onPress={() => go({ extraMin: extra, ...when })} /></View>
            ))}
            {busy ? <View style={{ marginTop: 6 }}><Button label="Switch busy mode off" kind="danger" disabled={work} onPress={() => go({ off: true })} /></View> : null}
        </Sheet>
    );
}

// The list itself. onGo() is called just before navigating (the side menu closes itself).
export function ShopMenu({ onGo }) {
    const nav = useNavigation();
    const { error } = useBrand();
    const logout = useAuthStore((s) => s.logout);
    const unread = useOwnerStore((st) => st.unread);
    const user = useAuthStore((st) => st.user);
    const [busy, setBusyState] = useState(null);
    const [busyOpen, setBusyOpen] = useState(false);
    useFocusEffect(useCallback(() => {
        fetchSettings().then((x) => setBusyState(x.orders.busy || null)).catch(() => { });
    }, []));

    const go = (route) => { if (onGo) onGo(); nav.navigate(route); };
    const customerView = () => {
        if (onGo) onGo();
        nav.navigate('CustomerPreview');   // a page on top of the owner panel; it slides in like any page
        showToast('Customer view. You cannot place orders from your own number.');
    };
    const out = async () => {
        if (onGo) onGo();
        const yes = await ask({ title: 'Log out?', message: 'You will stop getting new order alerts on this phone.', confirmText: 'Log out', destructive: true });
        if (yes) logout();
    };

    return (
        <View>
            <SectionTitle title="Alerts" />
            <Card>
                <Row icon="notifications" title="Messages for you" subtitle="From the platform and about your shop" onPress={() => go('OwnerNotifications')} right={unread > 0 ? <Pill label={String(unread)} color={error} /> : undefined} />
                <Row icon="volume-high" title="Soundbox" subtitle="New-order sound, voice and volume" onPress={() => go('Soundbox')} last />
            </Card>

            <SectionTitle title="Kitchen" />
            <Card>
                <Row icon="flame" title="Busy mode" subtitle={busy ? `On: +${busy.extraMin} min until ${clockTime(busy.until)}` : 'Show a longer wait when you are rushed'} color={busy ? error : undefined} onPress={() => setBusyOpen(true)} />
                <Row icon="document-text" title="Closing report" subtitle="The day in one page: sales, cash, orders" onPress={() => go('OwnerClosing')} last />
            </Card>

            {GROUPS.map(([group, rows]) => (
                <View key={group}>
                    <SectionTitle title={group} />
                    <Card>
                        {rows.map(([icon, title, subtitle, route], i) => (
                            <Row key={title} icon={icon} title={title} subtitle={subtitle} last={i === rows.length - 1} onPress={() => go(route)} />
                        ))}
                    </Card>
                </View>
            ))}

            <SectionTitle title="Your app" />
            <Card>
                <Row icon="person-circle" title="My profile" subtitle={user?.name || user?.phone || 'Your name, picture and email'} onPress={() => go('OwnerProfile')} />
                <AppearanceSwitch />
                <Row icon="eye" title="See the customer app" subtitle="Look at your shop the way customers do. You cannot order from your own number." onPress={customerView} />
                <Row icon="log-out" title="Log out" color={error} onPress={out} last />
            </Card>

            <BusySheet visible={busyOpen} busy={busy} onClose={() => setBusyOpen(false)} onChanged={setBusyState} />
        </View>
    );
}

export default function ShopHubScreen() {
    const { background } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title="Shop menu" />
            <ScrollView contentContainerStyle={{ paddingBottom: 60 }}><ShopMenu /></ScrollView>
        </View>
    );
}
