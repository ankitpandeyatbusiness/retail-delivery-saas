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
import { Label, Toggle } from '../../components/owners/menuBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { setBusy, apiError } from '../../api/owners/shopApi';
import { useMenuFlags } from '../../utils/owners/menuFlags';
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
    OwnerInquiries: 'inquiries inquiry enquiry reply bulk tiffin party booking customer asked',
    OwnerServices: 'services bulk order tiffin party booking catering inquiry inquiries custom',
    OwnerCoupons: 'coupon discount code offer promo voucher only for dine in first order percent flat',
    OwnerBanners: 'banner offer picture home slider image',
    OwnerHero: 'hero login picture photo image slider home screen background',
    OwnerBusiness: 'report chart sales progress revenue tips analytics growth',
    OwnerPopular: 'popular best selling items top dishes week month',
    OwnerTransactions: 'transactions bills payments invoice money history year month gst receipt',
    OwnerDineIn: 'dine in tables table qr sticker print walkout unpaid bill tip waiter call feedback refer friend offers welcome regular happy hour split busy auto ready served report scan nudge limit',
    OwnerHours: 'opening hours timing holiday closed weekly open close time',
    OwnerDelivery: 'delivery area fee distance radius pin map packaging charge tips minimum order preparation time free above km',
    OwnerMoney: 'money rent bill pay sms balance top up wallet',
    OwnerCooks: 'kitchen staff cook cooks chef team people employees add login leave',
    OwnerWaiters: 'waiter waiters staff floor serve team people employees add login leave',
    OwnerStaff: 'staff kitchen cook chef waiter waiters team people employees add login panel',
    AlertSettings: 'alerts notifications popup sound voice ring silent mute recommended',
    OwnerAppLock: 'lock pin password fingerprint face biometric security privacy protect',
    OwnerRiderRules: 'rider riders cash limit cod pickup cash orders waiting change pickup time orders at the same time delivery limit table bill block pay payout pin tracking assign automatic manual',
    OwnerMoneyRules: 'cancel cancelled refund rules cost who pays order loss',
    OwnerShopSettings: 'phone address sms alerts monthly report shop name contact',
    OwnerActivity: 'activity log history changes audit who changed',
    LegalList: 'terms privacy policy agreement legal',
};

// Easy mode shows only these (the things a shop uses every day); everything else is one switch away.
const EASY = new Set(['@busy', 'OwnerClosing', 'OwnerDineIn', 'OwnerCooks', 'OwnerWaiters', 'OwnerCustomers', 'OwnerComplaints', 'OwnerMessages', 'OwnerCategories', 'OwnerCoupons', 'OwnerMoney', 'OwnerMoneyHub', 'OwnerBillsHub', 'OwnerReportsHub', 'OwnerHours', 'OwnerShopSettings', 'AlertSettings', 'Soundbox', 'OwnerAppLock']);
const EASY_APP = new Set(['My profile', 'Appearance', 'Language', 'See the customer app', 'Log out']);

// [icon, title, subtitle, route]   ('@busy' opens the Busy mode sheet). The order is the order of a working day.
const GROUPS = [
    ['Daily work', [
        ['flame', 'Busy mode', 'Show a longer wait when you are rushed', '@busy'],
        ['document-text', 'Closing report', 'The day in one page: sales, cash, orders', 'OwnerClosing'],
        ['restaurant', 'Dine in', 'Customers eating at your tables: switch on, tables', 'OwnerDineIn'],
        ['flame', 'Kitchen staff', 'Your cooks: what they made, leave, add or remove', 'OwnerCooks'],
        ['restaurant', 'Waiters', 'Your waiters: what they served, leave, add or remove', 'OwnerWaiters'],
    ]],
    ['Customers and care', [
        ['people', 'Customers', 'Your customers, their orders, allow cash on delivery', 'OwnerCustomers'],
        ['chatbubble-ellipses', 'Complaints', 'Reply to and resolve complaints', 'OwnerComplaints'],
        ['star', 'Reviews', 'What customers say about your food and delivery', 'OwnerReviews'],
        ['megaphone', 'Messages', 'Send a message to customers or riders', 'OwnerMessages'],
        ['rocket', 'Autopilot', 'Reminders that bring customers back, by themselves', 'OwnerAutopilot'],
        ['gift', 'Rewards and points', 'Customer points, rider points and badges', 'OwnerRewards'],
    ]],
    ['Menu and offers', [
        ['list', 'Categories', 'Order, pictures and opening hours of each section', 'OwnerCategories'],
        ['pricetag', 'Coupons', 'Discount codes', 'OwnerCoupons'],
        ['chatbubbles', 'Inquiries', 'What customers asked about your services, and your replies', 'OwnerInquiries'],
        ['briefcase', 'Services', 'Bulk orders, tiffin, party booking and your own services', 'OwnerServices'],
        ['images', 'Home screen', 'Banners, festival strips and the big pictures at the top', 'OwnerShopFrontHub'],
    ]],
    ['Money', [
        ['wallet', 'Money', 'Your rent, SMS balance and top up', 'OwnerMoney'],
        ['swap-vertical', 'Transactions', 'Every rupee in and out, by month, refunds and chargebacks', 'OwnerMoneyHub'],
        ['receipt', 'Bills and SMS', 'Your monthly bill and SMS balance', 'OwnerBillsHub'],
        ['trending-up', 'Business report', 'Progress charts, popular items, tips', 'OwnerReportsHub'],
    ]],
    ['Shop settings', [
        ['time', 'Opening hours', 'Weekly hours and holidays', 'OwnerHours'],
        ['navigate', 'Delivery', 'Area, fees, riders, cash limits and pickup rules', 'OwnerDeliveryHub'],
        ['cash', 'Cancel and refund rules', 'Who bears the cost of a cancelled order', 'OwnerMoneyRules'],
        ['settings', 'Shop settings', 'Phone, address, SMS alerts', 'OwnerShopSettings'],
        ['list-circle', 'Inbox and activity', 'Your messages, and who changed what', 'OwnerInboxHub'],
    ]],
    ['Alerts and security', [
        ['notifications', 'Alerts', 'Choose the notification, sound, voice and slider for each alert', 'AlertSettings'],
        ['volume-high', 'Soundbox', 'New-order sound, voice and volume', 'Soundbox'],
        ['lock-closed', 'App lock', 'Ask for a PIN, fingerprint or face when the app opens', 'OwnerAppLock'],
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
    const busy = useMenuFlags((s) => s.busy);
    const setBusyState = useMenuFlags.getState().setBusy;
    const [busyOpen, setBusyOpen] = useState(false);
    const [langOpen, setLangOpen] = useState(false);
    // what the platform switched on for this shop: Kitchen staff and Waiters are only listed when it did. Kept between openings, so all rows are there at once
    const kitchenOn = useMenuFlags((s) => s.kitchenOn);
    const waiterOn = useMenuFlags((s) => s.waiterOn);
    const staffOn = { kitchenOn, waiterOn };
    const lang = useLang((st) => st.lang);
    useFocusEffect(useCallback(() => { useMenuFlags.getState().refresh(); }, []));

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
    const { border, muted, text, surface, primary } = useBrand();
    const easy = useMenuFlags((s) => s.easy);
    const hidden = (route) => (route === 'OwnerCooks' && !staffOn.kitchenOn) || (route === 'OwnerWaiters' && !staffOn.waiterOn) || (easy && !EASY.has(route));
    // every row of the menu as one list (what is shown, and what the search looks through)
    const sections = useMemo(() => [
        ...GROUPS.map(([group, rows]) => [group, rows.filter((r) => !hidden(r[3])).map(([icon, title, subtitle, route]) => (route === '@busy'
            ? { icon, title, subtitle: busy ? tr('On: +{extraMin} min until {clockTime}', { extraMin: busy.extraMin, clockTime: clockTime(busy.until) }) : tr(subtitle), group, words: 'busy rushed longer wait kitchen crowd', color: busy ? error : undefined, act: () => setBusyOpen(true) }
            : { icon, title, subtitle: tr(subtitle), group, words: WORDS[route] || '', act: () => go(route) }))]),
        ['Your app', [
            { icon: 'help-buoy', title: 'Help and support', subtitle: tr('Ask the platform team for help'), group: 'Your app', words: 'help support ask platform team contact problem', right: supportUnread > 0 ? <Pill label={String(supportUnread)} color={error} /> : undefined, act: () => go('OwnerSupport') },
            { icon: 'person-circle', title: 'My profile', subtitle: user?.name || user?.phone || tr('Your name, picture and email'), group: 'Your app', words: 'profile name picture email account', act: () => go('OwnerProfile') },
            { custom: 'appearance', title: 'Appearance', group: 'Your app', words: 'appearance dark light theme mode' },
            { icon: 'language', title: 'Language', subtitle: LANGS.find((l) => l.code === lang)?.native, group: 'Your app', words: 'language hindi tamil telugu marathi translate', act: () => setLangOpen(true) },
            { icon: 'eye', title: 'See the customer app', subtitle: tr('Look at your shop the way customers do. You cannot order from your own number.'), group: 'Your app', words: 'customer view preview app', act: customerView },
            { icon: 'document-text', title: 'Terms and privacy', subtitle: tr('Your agreement, the terms and the privacy policy'), group: 'Your app', words: WORDS.LegalList, act: () => go('LegalList') },
            { icon: 'log-out', title: 'Log out', subtitle: tr('Sign out of this phone'), group: 'Your app', words: 'logout log out sign out exit', color: error, act: out },
        ]],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [busy, staffOn, supportUnread, user, lang, easy]);
    const entries = useMemo(() => sections.flatMap(([, rows]) => rows).filter((e) => !e.custom), [sections]);
    const found = q.trim() ? searchMenu(entries, q, (e) => `${e.title} ${tr(e.title)}`) : null;

    return (
        <View>
            {/* Easy mode: only the things used every day */}
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Ionicons name="leaf" size={22} color={easy ? primary : muted} />
                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('Easy mode')}</Text>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 1 }}>{easy ? tr('Showing only what you use every day') : tr('Show only what you use every day')}</Text>
                    </View>
                    <Toggle value={easy} onValueChange={(v) => useMenuFlags.getState().setEasy(v)} />
                </View>
            </Card>
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
                            {found.map((e, i) => <Row key={e.title} icon={e.icon} title={tr(e.title)} subtitle={`${tr(e.group)} · ${e.subtitle}`} last={i === found.length - 1} onPress={() => { setQ(''); e.act(); }} />)}
                        </Card>
                    ) : <Text style={{ color: muted, paddingHorizontal: 20, paddingVertical: 8 }}>{tr('Try another word, like cash, tip, table or picture.')}</Text>}
                </View>
            ) : (
                <View>
                    {sections.map(([group, rowsAll]) => { const rows = easy && group === 'Your app' ? rowsAll.filter((e) => EASY_APP.has(e.title)) : rowsAll; return (rows.length ? (
                        <View key={group}>
                            <SectionTitle title={tr(group)} />
                            <Card>
                                {rows.map((e, i) => (e.custom ? <AppearanceSwitch key={e.title} /> : <Row key={e.title} icon={e.icon} title={tr(e.title)} subtitle={e.subtitle} color={e.color} right={e.right} last={i === rows.length - 1} onPress={e.act} />))}
                            </Card>
                        </View>
                    ) : null); })}
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
