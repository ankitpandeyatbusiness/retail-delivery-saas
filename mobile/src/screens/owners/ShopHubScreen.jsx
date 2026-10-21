// The shop menu: everything that is not one of the five tabs. It is the side menu opened by the hamburger at the top
// left of every tab (components/owners/OwnerDrawer.jsx); the same list is also available as a full page (ShopHub).
import React, { useCallback, useMemo, useState } from 'react';
import { View, ScrollView, TextInput, Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { searchMenu } from '../../utils/owners/menuSearch';
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
import { tr, LANGS, useLang } from '../../i18n';
import LanguageSheet from '../../components/common/LanguageSheet';

// words hidden inside each screen, so a search finds a screen by what is in it ("tip" finds Delivery area and fees)
const WORDS = {
    OwnerCategories: 'category section menu pictures timing hours reorder sort',
    OwnerCollections: 'festival combo strip home collection special',
    OwnerCustomers: 'customer block blocked unblock allow cash on delivery cod strikes phone orders history person people',
    OwnerComplaints: 'complaint issue problem reply resolve',
    OwnerReviews: 'review rating stars feedback delivery food',
    OwnerMessages: 'message notify announcement broadcast sms push send',
    OwnerAutopilot: 'autopilot reminder win back coupon inactive customers automatic',
    OwnerRewards: 'points rewards badge loyalty levels expiry top riders gift bronze silver gold platinum',
    OwnerCoupons: 'coupon discount code offer promo voucher only for dine in first order percent flat',
    OwnerBanners: 'banner offer picture home slider image',
    OwnerHero: 'hero login picture photo image slider home screen background',
    OwnerBusiness: 'report chart sales progress revenue tips analytics growth',
    OwnerPopular: 'popular best selling items top dishes week month',
    OwnerTransactions: 'transactions bills payments invoice money history year month gst receipt',
    OwnerDineIn: 'dine in tables table qr sticker print walkout unpaid bill tip waiter call feedback refer friend offers welcome regular happy hour split busy auto ready served report scan nudge limit',
    OwnerHours: 'opening hours timing holiday closed weekly open close time',
    OwnerDelivery: 'delivery area fee distance radius pin map packaging charge tips minimum order preparation time free above km',
    OwnerStaff: 'staff kitchen cook chef waiter waiters team people employees add login panel',
    OwnerAppLock: 'lock pin password fingerprint face biometric security privacy protect',
    OwnerRiderRules: 'rider riders cash limit cod pickup cash orders waiting change pickup time orders at the same time delivery limit table bill block pay payout pin tracking assign automatic manual',
    OwnerMoneyRules: 'cancel cancelled refund rules cost who pays order loss',
    OwnerShopSettings: 'phone address sms alerts monthly report shop name contact',
    OwnerActivity: 'activity log history changes audit who changed',
    LegalList: 'terms privacy policy agreement legal',
};

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
        ['rocket', 'Autopilot', 'Reminders that bring customers back, by themselves', 'OwnerAutopilot'],
        ['gift', 'Rewards and points', 'Customer points, rider points and badges', 'OwnerRewards'],
    ]],
    ['Offers', [
        ['pricetag', 'Coupons', 'Discount codes', 'OwnerCoupons'],
        ['images', 'Banners', 'Pictures on the home screen', 'OwnerBanners'],
        ['image', 'Login and home pictures', 'The big pictures that slide at the top', 'OwnerHero'],
    ]],
    ['Money', [
        ['trending-up', 'Business report', 'Progress charts, what customers like, tips', 'OwnerBusiness'],
        ['trophy', 'Popular items', 'What sells most: last 7 days, 30 days, 3 months', 'OwnerPopular'],
        ['swap-vertical', 'Transactions and bills', 'Every payment, year by year and month by month', 'OwnerTransactions'],
    ]],
    ['Shop', [
        ['restaurant', 'Dine in', 'Customers eating at your tables: switch on, tables', 'OwnerDineIn'],
        ['time', 'Opening hours', 'Weekly hours and holidays', 'OwnerHours'],
        ['navigate', 'Delivery area and fees', 'Pin, distance, delivery fee, packaging, tips', 'OwnerDelivery'],
        ['people', 'Kitchen and waiter staff', 'Add your cooks and waiters with their numbers', 'OwnerStaff'],
        ['bicycle', 'Delivery and cash rules', 'Riders, cash limits, cash for pickup orders', 'OwnerRiderRules'],
        ['cash', 'Cancel and refund rules', 'Who bears the cost of a cancelled order', 'OwnerMoneyRules'],
        ['lock-closed', 'App lock', 'Ask for a PIN, fingerprint or face when the app opens', 'OwnerAppLock'],
        ['settings', 'Shop settings', 'Phone, address, SMS alerts', 'OwnerShopSettings'],
        ['list-circle', 'Activity log', 'Who changed what', 'OwnerActivity'],
        ['document-text', 'Terms and privacy', 'Your agreement, the terms and the privacy policy', 'LegalList'],
    ]],
];

// Busy mode: the kitchen is rushed, customers see a longer wait for a while. It ends by itself.
export function BusySheet({ visible, busy, onClose, onChanged }) {
    const [extra, setExtra] = useState(15);
    const [work, setWork] = useState(false);
    const go = async (body) => {
        setWork(true);
        try {
            const r = await setBusy(body);
            onChanged(r.busy);
            showToast(r.busy ? tr('Busy mode is on') : tr('Back to normal'));
            onClose();
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setWork(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Busy mode')}>
            <Label hint={tr('Customers see a longer waiting time, so nobody expects food too soon. It ends by itself.')}>{tr('How much longer')}</Label>
            <Chips options={BUSY_EXTRA} value={extra} onChange={setExtra} style={{ marginTop: 0 }} />
            <Label>{tr('For how long')}</Label>
            {BUSY_FOR.map(([id, label, when]) => (
                <View key={id} style={{ marginBottom: 8 }}><Button label={label} kind="ghost" disabled={work} onPress={() => go({ extraMin: extra, ...when })} /></View>
            ))}
            {busy ? <View style={{ marginTop: 6 }}><Button label={tr('Switch busy mode off')} kind="danger" disabled={work} onPress={() => go({ off: true })} /></View> : null}
        </Sheet>
    );
}

// The list itself. onGo() is called just before navigating (the side menu closes itself).
export function ShopMenu({ onGo }) {
    const nav = useNavigation();
    const { error } = useBrand();
    const logout = useAuthStore((s) => s.logout);
    const supportUnread = useOwnerStore((st) => st.supportUnread);
    const user = useAuthStore((st) => st.user);
    const [busy, setBusyState] = useState(null);
    const [busyOpen, setBusyOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    const lang = useLang((st) => st.lang);
    useFocusEffect(useCallback(() => {
        fetchSettings().then((x) => setBusyState(x.orders.busy || null)).catch(() => { });
    }, []));

    const go = (route) => { if (onGo) onGo(); nav.navigate(route); };
    const customerView = () => {
        if (onGo) onGo();
        nav.navigate('CustomerPreview');   // a page on top of the owner panel; it slides in like any page
        showToast(tr('Customer view. You cannot place orders from your own number.'));
    };
    const out = async () => {
        if (onGo) onGo();
        const yes = await ask({ title: tr('Log out?'), message: tr('You will stop getting new order alerts on this phone.'), confirmText: tr('Log out'), destructive: true });
        if (yes) logout();
    };

    const [q, setQ] = useState('');
    const { primary, border, muted, text, surface } = useBrand();
    // every row of the menu as one list for the search (the ones with a screen of their own, and the ones that open a sheet)
    const entries = useMemo(() => [
        { icon: 'volume-high', title: 'Soundbox', subtitle: 'New-order sound, voice and volume', group: 'Alerts', words: 'sound voice volume alert new order ring announce speaker', act: () => go('Soundbox') },
        { icon: 'flame', title: 'Busy mode', subtitle: 'Show a longer wait when you are rushed', group: 'Kitchen', words: 'busy rushed longer wait kitchen crowd', act: () => setBusyOpen(true) },
        { icon: 'document-text', title: 'Closing report', subtitle: 'The day in one page: sales, cash, orders', group: 'Kitchen', words: 'closing report day sales cash end of day summary', act: () => go('OwnerClosing') },
        ...GROUPS.flatMap(([group, rows]) => rows.map(([icon, title, subtitle, route]) => ({ icon, title, subtitle, group, words: WORDS[route] || '', act: () => go(route) }))),
        { icon: 'help-buoy', title: 'Help and support', subtitle: 'Ask the platform team for help', group: 'Your app', words: 'help support ask platform team contact problem', act: () => go('OwnerSupport') },
        { icon: 'person-circle', title: 'My profile', subtitle: 'Your name, picture and email', group: 'Your app', words: 'profile name picture email account', act: () => go('OwnerProfile') },
        { icon: 'language', title: 'Language', subtitle: 'Choose the language of the app', group: 'Your app', words: 'language hindi tamil telugu marathi translate', act: () => setLangOpen(true) },
        { icon: 'eye', title: 'See the customer app', subtitle: 'Look at your shop the way customers do', group: 'Your app', words: 'customer view preview app', act: customerView },
        { icon: 'log-out', title: 'Log out', subtitle: 'Sign out of this phone', group: 'Your app', words: 'logout log out sign out exit', act: out },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], []);
    const found = q.trim() ? searchMenu(entries, q, (e) => `${e.title} ${tr(e.title)}`) : null;

    return (
        <View>
            <View style={{ marginHorizontal: 16, marginTop: 6, marginBottom: 4, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, backgroundColor: surface, borderRadius: 14, paddingHorizontal: 12 }}>
                <Ionicons name="search" size={18} color={muted} />
                <TextInput
                    value={q} onChangeText={setQ} placeholder={tr('Search the menu')} placeholderTextColor={muted} autoCorrect={false} autoCapitalize="none"
                    style={{ flex: 1, paddingVertical: 11, paddingHorizontal: 8, color: text, fontSize: 15 }}
                />
                {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={muted} /></Pressable> : null}
            </View>

            {found ? (
                <View>
                    <SectionTitle title={found.length ? tr('{n} found', { n: found.length }) : tr('Nothing found')} />
                    {found.length ? (
                        <Card>
                            {found.map((e, i) => <Row key={e.title} icon={e.icon} title={e.title} subtitle={`${tr(e.group)} · ${e.subtitle}`} last={i === found.length - 1} onPress={() => { setQ(''); e.act(); }} />)}
                        </Card>
                    ) : <Text style={{ color: muted, paddingHorizontal: 20, paddingVertical: 8 }}>{tr('Try another word, like cash, tip, table or picture.')}</Text>}
                </View>
            ) : (
        <View>
            <SectionTitle title={tr('Alerts')} />
            <Card>
                <Row icon="volume-high" title={tr('Soundbox')} subtitle={tr('New-order sound, voice and volume')} onPress={() => go('Soundbox')} last />
            </Card>

            <SectionTitle title={tr('Kitchen')} />
            <Card>
                <Row icon="flame" title={tr('Busy mode')} subtitle={busy ? tr('On: +{extraMin} min until {clockTime}', { extraMin: busy.extraMin, clockTime: clockTime(busy.until) }) : tr('Show a longer wait when you are rushed')} color={busy ? error : undefined} onPress={() => setBusyOpen(true)} />
                <Row icon="document-text" title={tr('Closing report')} subtitle={tr('The day in one page: sales, cash, orders')} onPress={() => go('OwnerClosing')} last />
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

            <SectionTitle title={tr('Your app')} />
            <Card>
                <Row icon="help-buoy" title={tr('Help and support')} subtitle={tr('Ask the platform team for help')} onPress={() => go('OwnerSupport')} right={supportUnread > 0 ? <Pill label={String(supportUnread)} color={error} /> : undefined} />
                <Row icon="person-circle" title={tr('My profile')} subtitle={user?.name || user?.phone || tr('Your name, picture and email')} onPress={() => go('OwnerProfile')} />
                <AppearanceSwitch />
                <Row icon="language" title={tr('Language')} subtitle={LANGS.find((l) => l.code === lang)?.native} onPress={() => setLangOpen(true)} />
                <Row icon="eye" title={tr('See the customer app')} subtitle={tr('Look at your shop the way customers do. You cannot order from your own number.')} onPress={customerView} />
                <Row icon="log-out" title={tr('Log out')} color={error} onPress={out} last />
            </Card>

        </View>
            )}

            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
            <BusySheet visible={busyOpen} busy={busy} onClose={() => setBusyOpen(false)} onChanged={setBusyState} />
        </View>
    );
}

export default function ShopHubScreen() {
    const { background } = useBrand();
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Shop menu')} />
            <ScrollView contentContainerStyle={{ paddingBottom: 32 }}><ShopMenu /></ScrollView>
        </View>
    );
}
