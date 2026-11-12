// The shop menu: everything that is not one of the five tabs. It is the side menu opened by the hamburger at the top
// left of every tab (components/owners/OwnerDrawer.jsx); the same list is also available as a full page (ShopHub).
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, ScrollView, TextInput, Pressable, Text, Animated, Easing, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop } from '../../utils/common/layout';
import { searchMenu } from '../../utils/owners/menuSearch';
import AppearanceSwitch from '../../components/owners/AppearanceSwitch';
import { PageHeader, Card, Row, SectionTitle, Sheet, Button, Pill, Chips } from '../../components/owners/ui';
import { Label, Toggle } from '../../components/owners/menuBits';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { setBusy, apiError } from '../../api/owners/shopApi';
import { useAlertStore } from '../../store/owners/useAlertStore';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { BUSY_EXTRA, BUSY_FOR } from '../../utils/owners/settingsRules';
import { clockTime } from '../../utils/owners/orderFlow';
import { showToast } from '../../components/customers/shop';
import { useAuthStore } from '../../store/common/useAuthStore';
import { ask } from '../../components/common/dialog';
import { PlanTag, askUpgrade } from '../../components/owners/PlanLock';
import MenuIndexStrip, { useMenuIndex } from '../../components/owners/MenuIndexStrip';
import { ease } from '../../utils/common/ease';
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
    OwnerRiders: 'riders delivery partners cash map online team',
    OwnerAutomations: 'automations automatic auto accept by themselves no show reminders pickup not collected allow ready served busy',
    OwnerBookings: 'bookings table booking reservation reserve deposit seats slots timings',
    OwnerInquiries: 'inquiries inquiry enquiry reply bulk tiffin party booking customer asked',
    OwnerBulk: 'bulk order large quantity catering office party function quote wholesale',
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
    OwnerPlan: 'plan partner growth pro upgrade renew subscription price months features',
    OwnerWallet: 'wallet partner balance top up recharge fee per order',
    OwnerCosts: 'costs expenses profit loss spend salary rent ingredients electricity margin',
    OwnerExport: 'download export excel csv data customers orders riders cooks waiters branches menu report file spreadsheet',
};
// the search finds a screen by its English words and by the same words in the owner's language
const wordsOf = (w) => (w ? `${w} ${tr(w)}` : '');

// Easy mode shows only these (the things a shop uses every day); everything else is one switch away.
// "Growth, ends 12 Dec (21 days left)"
const planLineOf = (p) => {
    const name = p.id[0].toUpperCase() + p.id.slice(1);
    if (p.status === 'ended') return tr('{name} ended. Choose your plan', { name });
    return p.endsAt ? tr('{name}, ends {date} ({n} days left)', { name, date: new Date(p.endsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }), n: p.daysLeft }) : name;
};

// the menu heading below is shown through tr(group); this list lets the translation tool find the text (nothing calls it)
export const _menuHeadings = () => [tr('Your app'), tr('Branches'), tr('Run several shops from one account')];

// menu row -> the plan feature it needs (config/plans.js on the server)
const LOCKS = { OwnerAutopilot: 'customPush', OwnerRewards: 'loyalty', OwnerCosts: 'costsProfit', OwnerReportsHub: 'analytics', OwnerCooks: 'staffLogins', OwnerWaiters: 'staffLogins', OwnerServices: 'services', OwnerInquiries: 'services', OwnerBulk: 'bulkOrders', OwnerAllBranches: 'multiBranch', OwnerDineIn: 'dineIn' };

const EASY = new Set(['@busy', 'OwnerAutomations', 'OwnerRiders', 'OwnerBookings', 'OwnerServices', 'OwnerBulk', 'OwnerInquiries', 'OwnerClosing', 'OwnerDineIn', 'OwnerCooks', 'OwnerWaiters', 'OwnerCustomers', 'OwnerExport', 'OwnerCosts', 'OwnerComplaints', 'OwnerMessages', 'OwnerCategories', 'OwnerCoupons', 'OwnerMoney', 'OwnerMoneyHub', 'OwnerReportsHub', 'OwnerHours', 'OwnerShopSettings', 'AlertSettings', 'Soundbox', 'OwnerAppLock']);
const EASY_APP = new Set(['My profile', 'Appearance', 'Language', 'See the customer app', 'Log out']);

// [icon, title, subtitle, route]   ('@busy' opens the Busy mode sheet). The order is the order of a working day.
const GROUPS = [
    ['Daily work', [
        ['flash', 'Automations', 'What the shop does by itself: accepting, no-shows, reminders and more', 'OwnerAutomations'],
        ['flame', 'Busy mode', 'Show a longer wait when you are rushed', '@busy'],
        ['document-text', 'Closing report', 'The day in one page: sales, cash, orders', 'OwnerClosing'],
        ['restaurant', 'Dine in', 'Customers eating at your tables: switch on, tables', 'OwnerDineIn'],
        ['flame', 'Kitchen staff', 'Your cooks: what they made, leave, add or remove', 'OwnerCooks'],
        ['restaurant', 'Waiters', 'Your waiters: what they served, leave, add or remove', 'OwnerWaiters'],
        ['bicycle', 'Riders', 'Your delivery team: who is online, the cash they hold, the live map', 'OwnerRiders'],
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
        ['calendar', 'Reservations', 'Tables guests reserved, seat them, and your reservation rules', 'OwnerBookings'],
        ['chatbubbles', 'Inquiries', 'What customers asked about your services, and your replies', 'OwnerInquiries'],
        ['cube', 'Bulk orders', 'Large orders: quotes, bulk prices and the delivery fee for them', 'OwnerBulk'],
        ['briefcase', 'Services', 'Tiffin, party booking and your own services', 'OwnerServices'],
        ['images', 'Home screen', 'Banners, festival strips and the big pictures at the top', 'OwnerShopFrontHub'],
    ]],
    ['Money', [
        ['ribbon', 'Plan', 'Your plan, what is in it, upgrade or renew', 'OwnerPlan'],
        ['wallet', 'Money', 'Your sales, online money and SMS balance', 'OwnerMoney'],
        ['card', 'Wallet', 'Your Partner wallet: balance, top up, the fee of each order', 'OwnerWallet'],
        ['swap-vertical', 'Transactions', 'Every rupee in and out, by month, refunds and chargebacks', 'OwnerMoneyHub'],
        ['chatbubble-ellipses', 'SMS balance', 'Your SMS balance and top up', 'OwnerSms'],
        ['calculator', 'Costs and profit', 'What you spend, and what the shop really kept', 'OwnerCosts'],
        ['trending-up', 'Business report', 'Progress charts, popular items, tips', 'OwnerReportsHub'],
        ['download', 'Download your data', 'Excel files: customers, cooks, waiters, riders, orders, branches', 'OwnerExport'],
    ]],
    ['Shop settings', [
        ['time', 'Opening hours', 'Weekly hours and holidays', 'OwnerHours'],
        ['navigate', 'Delivery', 'Area, fees, riders, cash limits and pickup rules', 'OwnerDeliveryHub'],
        ['cash', 'Cancel and refund rules', 'Who bears the cost of a cancelled order', 'OwnerMoneyRules'],
        ['settings', 'Shop settings', 'Phone, address, SMS alerts', 'OwnerShopSettings'],
        ['storefront', 'Branches', 'Run several shops from one account', 'OwnerAllBranches'],
        ['list-circle', 'Inbox and activity', 'Your messages, and who changed what', 'OwnerInboxHub'],
    ]],
    ['Alerts and security', [
        ['notifications', 'Alerts', 'Choose the notification, sound, voice and slider for each alert', 'AlertSettings'],
        ['volume-high', 'Soundbox', 'New-order sound, voice and volume', 'Soundbox'],
        ...(Platform.OS === 'web' ? [] : [['lock-closed', 'App lock', 'Ask for a PIN, fingerprint or face when the app opens', 'OwnerAppLock']]),   // a phone feature: not on the website
    ]],
];

// Busy mode: the kitchen is rushed, customers see a longer wait for a while. It ends by itself.
export function BusySheet({ visible, busy, onClose, onChanged }) {
    const desk = useOwnerDesktop();   // a computer: big choice tiles instead of the phone's chips and buttons
    const { text, muted, border, primary, onPrimary } = useBrand();
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
            {desk ? (
                <View>
                    <View style={{ alignItems: 'center', marginBottom: 18 }}>
                        <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: alpha('#F59E0B', 0.16), alignItems: 'center', justifyContent: 'center' }}><Ionicons name="flame" size={34} color="#F59E0B" /></View>
                        <Text style={{ color: muted, textAlign: 'center', marginTop: 12, lineHeight: 20, maxWidth: 400 }}>{tr('Customers see a longer waiting time, so nobody expects food too soon. It ends by itself.')}</Text>
                    </View>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 14, marginBottom: 10 }}>{tr('How much longer')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
                        {BUSY_EXTRA.map(([v]) => {
                            const on = extra === v;
                            return (
                                <View key={v} style={{ width: '25%', padding: 5 }}>
                                    <Pressable onPress={() => setExtra(v)} style={({ hovered }) => ({ height: 64, borderRadius: 18, borderWidth: 1.5, borderColor: on ? primary : hovered ? alpha(primary, 0.55) : border, backgroundColor: on ? primary : hovered ? alpha(primary, 0.07) : 'transparent', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '140ms' })}>
                                        <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 20 }}>{v === 60 ? '+1' : `+${v}`}</Text>
                                        <Text style={{ color: on ? onPrimary : muted, fontWeight: '700', fontSize: 11.5 }}>{v === 60 ? tr('hour') : tr('min')}</Text>
                                    </Pressable>
                                </View>
                            );
                        })}
                    </View>
                    <Text style={{ color: text, fontWeight: '900', fontSize: 14, marginTop: 14, marginBottom: 10 }}>{tr('For how long')}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 }}>
                        {BUSY_FOR.map(([id, label, when]) => (
                            <View key={id} style={{ width: '50%', padding: 5 }}>
                                <Pressable disabled={work} onPress={() => go({ extraMin: extra, ...when })} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', height: 56, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1.5, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.07) : 'transparent', opacity: work ? 0.5 : 1, cursor: 'pointer', transitionProperty: 'background-color, border-color', transitionDuration: '140ms' })}>
                                    <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}><Ionicons name="time-outline" size={18} color={primary} /></View>
                                    <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 14.5 }} numberOfLines={2}>{tr(label)}</Text>
                                </Pressable>
                            </View>
                        ))}
                    </View>
                    {busy ? <View style={{ marginTop: 14 }}><Button label={tr('Switch busy mode off')} kind="danger" icon="power" disabled={work} onPress={() => go({ off: true })} /></View> : null}
                </View>
            ) : (
            <>
            <Label hint={tr('Customers see a longer waiting time, so nobody expects food too soon. It ends by itself.')}>{tr('How much longer')}</Label>
            <Chips options={BUSY_EXTRA.map(([v]) => [v, v === 60 ? tr('+1 hour') : tr('+{n} min', { n: v })])} value={extra} onChange={setExtra} style={{ marginTop: 0 }} />
            <Label>{tr('For how long')}</Label>
            {BUSY_FOR.map(([id, label, when]) => (
                <View key={id} style={{ marginBottom: 8 }}><Button label={tr(label)} kind="ghost" disabled={work} onPress={() => go({ extraMin: extra, ...when })} /></View>
            ))}
            {busy ? <View style={{ marginTop: 6 }}><Button label={tr('Switch busy mode off')} kind="danger" disabled={work} onPress={() => go({ off: true })} /></View> : null}
            </>
            )}
        </Sheet>
    );
}

// The list itself. onGo() is called just before navigating (the side menu closes itself).
// side: the owner's sidebar on a computer: the same entries as a slim list (small icon tile + name, the page you are on lit up) instead of the phone's big cards
export function ShopMenu({ onGo, side, activeRoute }) {
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
    const riderAttention = useAlertStore((s) => s.riderAttention);   // a rider cancelled, reported a problem or pressed help
    const servicesOn = useMenuFlags((s) => s.servicesOn);   // the super admin's switches for Services (with Inquiries) and Table booking
    const bookingOn = useMenuFlags((s) => s.bookingOn);
    const bulkOn = useMenuFlags((s) => s.bulkOn);   // the super admin's switch for Bulk orders
    const plan = useMenuFlags((s) => s.plan);   // what the plan allows (null = no plan yet: nothing is locked)
    // a row whose feature is not in the plan: it stays visible with "Available in Pro" and opens nothing (the server refuses it anyway)
    const lockedBy = (route) => { const key = LOCKS[route]; return key && plan && plan.features?.[key] === false ? plan.needs?.[key] || 'a higher plan' : null; };
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
    const { border, muted, text, surface, primary, onPrimary } = useBrand();
    const easy = useMenuFlags((s) => s.easy);
    const hidden = (route) => (route === 'OwnerAllBranches' && !lockedBy(route)) || (route === 'OwnerWallet' && plan?.id !== 'partner') || ((route === 'OwnerServices' || route === 'OwnerInquiries') && !servicesOn && !lockedBy(route)) || (route === 'OwnerBulk' && !bulkOn && !lockedBy(route)) || (route === 'OwnerBookings' && !bookingOn) || (route === 'OwnerCooks' && !staffOn.kitchenOn) || (route === 'OwnerWaiters' && !staffOn.waiterOn) || (easy && !EASY.has(route));
    // every row of the menu as one list (what is shown, and what the search looks through)
    const sections = useMemo(() => [
        ...GROUPS.map(([group, rows]) => [group, rows.filter((r) => !hidden(r[3])).map(([icon, title, subtitle, route]) => (route === '@busy'
            ? { route, icon, title, subtitle: busy ? tr('On: +{extraMin} min until {clockTime}', { extraMin: busy.extraMin, clockTime: clockTime(busy.until) }) : tr(subtitle), group, words: 'busy rushed longer wait kitchen crowd', color: busy ? error : undefined, act: () => setBusyOpen(true) }
            : route === 'OwnerPlan' && plan?.id
                ? { route, icon, title, subtitle: planLineOf(plan), group, words: wordsOf(WORDS[route]), right: plan.status === 'ended' ? <Pill label="!" color={error} /> : undefined, act: () => go(route) }
            : lockedBy(route)
                ? { route, icon: 'lock-closed', title, subtitle: tr('Available in {plan}', { plan: lockedBy(route) }), group, words: wordsOf(WORDS[route]), tag: lockedBy(route), act: () => askUpgrade(nav, { title: tr(title), message: tr(subtitle), need: lockedBy(route), feature: LOCKS[route] }, go) }
                : { route, icon, title, subtitle: tr(subtitle), group, words: wordsOf(WORDS[route]), right: route === 'OwnerRiders' && riderAttention ? <Pill label="!" color={error} /> : undefined, tag: route === 'OwnerExport' && plan?.features?.fullExports === false ? plan.needs?.fullExports || 'Pro' : undefined, act: () => go(route) }))]),
        ['Your app', [
            { icon: 'help-buoy', title: 'Help and support', subtitle: tr('Ask the platform team for help'), group: 'Your app', words: 'help support ask platform team contact problem', right: supportUnread > 0 ? <Pill label={String(supportUnread)} color={error} /> : undefined, route: 'OwnerSupport', act: () => go('OwnerSupport') },
            { icon: 'person-circle', title: 'My profile', subtitle: user?.name || user?.phone || tr('Your name, picture and email'), group: 'Your app', words: 'profile name picture email account', route: 'OwnerProfile', act: () => go('OwnerProfile') },
            { custom: 'appearance', title: 'Appearance', group: 'Your app', words: 'appearance dark light theme mode' },
            { icon: 'language', title: 'Language', subtitle: LANGS.find((l) => l.code === lang)?.native, group: 'Your app', words: 'language hindi tamil telugu marathi translate', act: () => setLangOpen(true) },
            { icon: 'eye', title: 'See the customer app', subtitle: tr('Look at your shop the way customers do. You cannot order from your own number.'), group: 'Your app', words: 'customer view preview app', act: customerView },
            { icon: 'information-circle', title: 'About Us', subtitle: tr('About the platform, terms and privacy'), group: 'Your app', words: 'about us platform company vivyaan terms privacy', route: 'AboutUs', act: () => go('AboutUs') },
            { icon: 'phone-portrait', title: "Where you're logged in", subtitle: tr('Phones and browsers signed in as you'), group: 'Your app', words: 'logged in devices sessions security browser website sign out all', route: 'Sessions', act: () => go('Sessions') },
            { icon: 'log-out', title: 'Log out', subtitle: tr('Sign out of this phone'), group: 'Your app', words: 'logout log out sign out exit', color: error, act: out },
        ]],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [busy, staffOn, servicesOn, bookingOn, bulkOn, plan, riderAttention, supportUnread, user, lang, easy]);
    const entries = useMemo(() => sections.flatMap(([, rows]) => rows).filter((e) => !e.custom), [sections]);
    const found = q.trim() ? searchMenu(entries, q, (e) => `${e.title} ${tr(e.title)}`) : null;

    // A to Z: every screen in one list by name, grouped under its letter (English only: the other languages keep the sections)
    const sortAZ = useMenuFlags((s) => s.sortAZ);
    const english = lang === 'en';
    const az = !side && english && sortAZ && !found;
    const azGroups = useMemo(() => {
        if (!az) return [];
        const rows = sections.filter(([g]) => g !== 'Your app').flatMap(([g, rs]) => rs.filter((e) => !e.custom).map((e) => ({ ...e, group: g }))).sort((a, b) => a.title.localeCompare(b.title, 'en'));
        const by = [];
        for (const e of rows) {
            const letter = /^[A-Za-z]/.test(e.title) ? e.title[0].toUpperCase() : '#';
            const last = by[by.length - 1];
            if (last && last.letter === letter) last.rows.push(e); else by.push({ letter, rows: [e] });
        }
        return by;
    }, [az, sections]);
    useEffect(() => { useMenuIndex.getState().setOn(az); return () => useMenuIndex.getState().setOn(false); }, [az]);
    // Easy mode or Sort A to Z changes what the list holds: the new list fades and rises into place, so the change is soft (in the side menu too, where the
    // layout glide alone is not always seen)
    const swap = useRef(new Animated.Value(1)).current;
    const firstSwap = useRef(true);
    useEffect(() => {
        if (firstSwap.current) { firstSwap.current = false; return; }
        swap.setValue(0);
        Animated.timing(swap, { toValue: 1, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    }, [easy, az]);   // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {   // a letter that no screen starts with any more (Easy mode, a switched-off job) leaves the strip
        const keep = new Set(azGroups.map((g) => g.letter));
        useMenuIndex.setState((s) => ({ ys: Object.fromEntries(Object.entries(s.ys).filter(([k]) => keep.has(k))) }));
    }, [azGroups]);

    if (side) {
        const sideRow = (e, note) => {
            const on = !!e.route && e.route === activeRoute;
            const tint = e.color || primary;
            return (
                <Pressable key={e.title} onPress={e.act} accessibilityRole="button" style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 42, borderRadius: 14, paddingVertical: 5, paddingHorizontal: 8, marginBottom: 2, backgroundColor: on ? alpha(primary, 0.13) : hovered ? alpha(muted, 0.12) : 'transparent', cursor: 'pointer', transitionProperty: 'background-color', transitionDuration: '120ms' })}>
                    {on ? <View style={{ position: 'absolute', left: -4, top: 10, bottom: 10, width: 4, borderRadius: 2, backgroundColor: primary }} /> : null}
                    <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: on ? primary : alpha(tint, 0.12), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={e.icon} size={16} color={on ? onPrimary : tint} /></View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 11 }}>
                        <Text numberOfLines={1} style={{ color: on ? primary : e.color || text, fontSize: 14, fontWeight: on ? '900' : '700' }}>{tr(e.title)}</Text>
                        {note ? <Text numberOfLines={1} style={{ color: muted, fontSize: 11.5, marginTop: 1 }}>{note}</Text> : null}
                    </View>
                    {e.right || (e.tag ? <PlanTag need={e.tag} /> : null)}
                </Pressable>
            );
        };
        return (
            <View style={{ paddingHorizontal: 12, paddingTop: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 14, paddingHorizontal: 12, height: 42, backgroundColor: alpha(muted, 0.1) }}>
                    <Ionicons name="search" size={17} color={muted} />
                    <TextInput value={q} onChangeText={setQ} placeholder={tr('Search the menu')} placeholderTextColor={muted} autoCorrect={false} autoCapitalize="none" style={{ flex: 1, paddingHorizontal: 8, color: text, fontSize: 14 }} />
                    {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={muted} /></Pressable> : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingHorizontal: 8, height: 38 }}>
                    <Ionicons name="leaf" size={17} color={easy ? primary : muted} />
                    <Text style={{ flex: 1, marginLeft: 11, color: text, fontSize: 13.5, fontWeight: '800' }} numberOfLines={1}>{tr('Easy mode')}</Text>
                    <Toggle value={easy} onValueChange={(v) => useMenuFlags.getState().setEasy(v)} />
                </View>
                <Animated.View style={{ opacity: swap, transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
                    {found ? (
                        <View>
                            <Text style={{ color: muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: 14, marginBottom: 6, paddingHorizontal: 8 }}>{(found.length ? tr('{n} found', { n: found.length }) : tr('Nothing found')).toUpperCase()}</Text>
                            {found.length ? found.map((e) => sideRow({ ...e, act: () => { setQ(''); e.act(); } }, tr(e.group))) : <Text style={{ color: muted, paddingHorizontal: 8, fontSize: 13 }}>{tr('Try another word, like cash, tip, table or picture.')}</Text>}
                        </View>
                    ) : sections.map(([group, rowsAll]) => {
                        const rows = easy && group === 'Your app' ? rowsAll.filter((e) => EASY_APP.has(e.title)) : rowsAll;
                        return rows.length ? (
                            <View key={group}>
                                <Text style={{ color: muted, fontSize: 11, fontWeight: '900', letterSpacing: 1.2, marginTop: 16, marginBottom: 6, paddingHorizontal: 8 }}>{tr(group).toUpperCase()}</Text>
                                {rows.map((e) => (e.custom ? <AppearanceSwitch key={e.title} /> : sideRow(e)))}
                            </View>
                        ) : null;
                    })}
                </Animated.View>
                <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
                <BusySheet visible={busyOpen} busy={busy} onClose={() => setBusyOpen(false)} onChanged={setBusyState} />
            </View>
        );
    }

    return (
        <View>
            {/* the two switches and the search box in one slim block; its height is where the list (and the A to Z strip) starts */}
            <View onLayout={(e) => useMenuIndex.getState().setBase(e.nativeEvent.layout.height)}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2 }}>
                        <Ionicons name="leaf" size={20} color={easy ? primary : muted} />
                        <View style={{ flex: 1, marginHorizontal: 10 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 14 }}>{tr('Easy mode')}</Text>
                            <Text style={{ color: muted, fontSize: 11.5 }} numberOfLines={1}>{easy ? tr('Showing only what you use every day') : tr('Show only what you use every day')}</Text>
                        </View>
                        <Toggle value={easy} onValueChange={(v) => useMenuFlags.getState().setEasy(v)} />
                    </View>
                    {english ? (
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 2, marginTop: 6, paddingTop: 8, borderTopWidth: 0.5, borderTopColor: border }}>
                            <Ionicons name="text" size={20} color={sortAZ ? primary : muted} />
                            <View style={{ flex: 1, marginHorizontal: 10 }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 14 }}>{tr('Sort A to Z')}</Text>
                                <Text style={{ color: muted, fontSize: 11.5 }} numberOfLines={1}>{sortAZ ? tr('One list by name. Slide on the letters on the right.') : tr('Show every screen in one list by name')}</Text>
                            </View>
                            <Toggle value={sortAZ} onValueChange={(v) => useMenuFlags.getState().setSortAZ(v)} />
                        </View>
                    ) : null}
                </Card>
                <View style={{ marginHorizontal: 16, marginTop: 4, marginBottom: 2, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, backgroundColor: surface, borderRadius: 12, paddingHorizontal: 12 }}>
                    <Ionicons name="search" size={17} color={muted} />
                    <TextInput
                        value={q} onChangeText={setQ} placeholder={tr('Search the menu')} placeholderTextColor={muted} autoCorrect={false} autoCapitalize="none"
                        style={{ flex: 1, paddingVertical: 7, paddingHorizontal: 8, color: text, fontSize: 14.5 }}
                    />
                    {q ? <Pressable onPress={() => setQ('')} hitSlop={8}><Ionicons name="close-circle" size={18} color={muted} /></Pressable> : null}
                </View>
            </View>

            <Animated.View style={{ opacity: swap, transform: [{ translateY: swap.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
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
                    {az ? (
                        <View style={{ paddingRight: 26 }}>
                            {azGroups.map(({ letter, rows }) => (
                                <View key={letter} onLayout={(e) => { if (letter !== '#') useMenuIndex.getState().setY(letter, e.nativeEvent.layout.y); }}>
                                    <SectionTitle title={letter} />
                                    <Card>
                                        {rows.map((e, i) => <Row key={e.title} icon={e.icon} title={tr(e.title)} subtitle={`${tr(e.group)} · ${e.subtitle}`} color={e.color} right={e.right || (e.tag ? <PlanTag need={e.tag} /> : undefined)} last={i === rows.length - 1} onPress={e.act} />)}
                                    </Card>
                                </View>
                            ))}
                        </View>
                    ) : null}
                    {sections.filter(([g]) => !az || g === 'Your app').map(([group, rowsAll]) => { const rows = easy && group === 'Your app' ? rowsAll.filter((e) => EASY_APP.has(e.title)) : rowsAll; return (rows.length ? (
                        <View key={group} style={az ? { paddingRight: 26 } : null}>
                            <SectionTitle title={tr(group)} />
                            <Card>
                                {rows.map((e, i) => (e.custom ? <AppearanceSwitch key={e.title} /> : <Row key={e.title} icon={e.icon} title={tr(e.title)} subtitle={tr(e.subtitle)} color={e.color} right={e.right || (e.tag ? <PlanTag need={e.tag} /> : undefined)} last={i === rows.length - 1} onPress={e.act} />))}
                            </Card>
                        </View>
                    ) : null); })}
                </View>
            )}
            </Animated.View>

            <LanguageSheet visible={langOpen} onClose={() => setLangOpen(false)} />
            <BusySheet visible={busyOpen} busy={busy} onClose={() => setBusyOpen(false)} onChanged={setBusyState} />
        </View>
    );
}

export default function ShopHubScreen() {
    const { background } = useBrand();
    const sc = useRef(null);
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Shop menu')} />
            <ScrollView ref={sc} scrollEventThrottle={16} onScroll={(e) => useMenuIndex.getState().setScroll(e.nativeEvent.contentOffset.y)} contentContainerStyle={{ paddingBottom: 32 }}><ShopMenu /></ScrollView>
            <MenuIndexStrip scrollRef={sc} top={110} bottom={24} />
        </View>
    );
}
