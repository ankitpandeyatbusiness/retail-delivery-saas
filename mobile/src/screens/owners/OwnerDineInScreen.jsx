// Dine in: everything about customers eating at the shop, in one place.
//   Tables      a live board: free / eating / bill asked, with what each table owes. Tap a table for its bill and to take the payment.
//   Settings    switch it on, the number of tables, when an idle table closes by itself (each with a recommended value)
// (QR stickers, offers, waiting time and table service are added here as they are built.)
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { Button, Sheet, SectionTitle, Card, Pill } from '../../components/owners/ui';
import { FormPage, Group, NumberBox, TextBox, ToggleRow } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import GlowBorder from '../../components/common/GlowBorder';
import { fetchSettings, saveSettings, fetchDineTables, fetchDineBill, settleDineBill, walkoutDineBill, fetchDineDebts, payDineDebt, fetchDineQr, fetchDineQrSheet, blockCustomer, apiError } from '../../api/owners/shopApi';
import { onNotification, onOrderUpdate } from '../../api/common/socket';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { Linking, Share } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import TableRequests, { GuestFeedback } from '../../components/owners/TableRequests';
import WaitTimer, { ServedIn } from '../../components/common/WaitTimer';
import BillDetails from '../../components/owners/BillDetails';
import BillSheet from '../../components/owners/BillSheet';
import PersonAvatar from '../../components/owners/PersonAvatar';
import { useClaimPrompt } from '../../components/owners/OwedClaimHost';
import { tr } from '../../i18n';

const RECOMMENDED = { waiterSettles: true, cancelGraceMin: 3, enabled: true, tableCount: 10, autoCloseHours: 6, tabLimitNew: 500, tabLimitTrusted: 2000, trustedAfter: 3, atShopCheck: true, radiusM: 250, checkMinutes: 20, autoReady: true, readyMin: 15, owedDaily: true, owedHour: 11, owedOnHome: true, referOn: true, referFriendPercent: 15, referFriendMax: 150, referPoints: 50, referLimit: 10, callOn: true, tipOn: true, tipChoices: [10, 20, 50], feedbackOn: true, waitMin: 15, welcomeOn: true, welcomePercent: 10, welcomeMax: 100, regularOn: true, regularAfter: 5, regularPercent: 5, regularMax: 50, happyOn: false, happyFrom: '15:00', happyTo: '18:00', happyPercent: 15, happyMax: 150, owedMax: 7, firstOnline: false, prefs: ['Make it spicy', 'Less spicy', 'Not spicy', 'Extra gravy', 'Less gravy', 'No coriander', 'No onion', 'No garlic', 'Less oil', 'Less salt'], autoServe: false, serveMin: 10, busyAuto: true, busyPercent: 70, busyExtraMin: 10 };
const KEYS = Object.keys(RECOMMENDED);
const rs = (n) => `₹${Math.round(n * 100) / 100}`;
// the table that has waited longest comes first; then tables with nothing waiting; free tables last, in number order
export function sortTables(list) {
    const rank = (t) => (t.state === 'free' ? 2 : t.waitingSince ? 0 : 1);
    return [...list].sort((a, b) => rank(a) - rank(b)
        || (rank(a) === 0 ? new Date(a.waitingSince) - new Date(b.waitingSince) : rank(a) === 1 ? new Date(a.since) - new Date(b.since) : Number(a.table) - Number(b.table)));
}
const hm = (d) => { if (!d) return ''; const x = new Date(d); const h = x.getHours(); return `${h % 12 || 12}:${String(x.getMinutes()).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`; };
// the people who ordered at this table (from the rounds)
const guests = (bill) => { const m = new Map(); for (const r of bill.rounds) { const c = r.customer; if (!c) continue; const key = c.phone || c.name || r.id; if (!m.has(key)) m.set(key, { key, ...c }); } return [...m.values()]; };
// "Make it spicy, No onion" -> the list the server keeps (blank ones dropped, at most 12)
const parsePrefs = (t) => [...new Set(String(t || '').split(/[,\n]/).map((x) => x.trim()).filter(Boolean))].slice(0, 12);
// "10, 20, 50" -> [10, 20, 50] (whole rupees, at most 4)
const parseTips = (t) => [...new Set(String(t || '').split(/[,\s]+/).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 1000))].slice(0, 4);
// the automations the Automatic / Manual choice switches together
const AUTO = ['autoReady', 'autoServe', 'busyAuto', 'owedDaily'];
const mins = (d) => Math.max(1, Math.round((Date.now() - new Date(d).getTime()) / 60000));
const STATE = { placed: 'Waiting', accepted: 'Accepted', preparing: 'Preparing', ready: 'Ready to serve', delivered: 'Served' };

export function TableCell({ t, onPress, blink }) {
    const { text, muted, border, ok, warn, error, surface } = useBrand();
    const asked = t.state === 'bill_asked' || !!t.check;
    const eating = t.state === 'eating';
    const glow = asked || (blink && (eating || asked));
    const inner = (
        <Pressable
            onPress={eating || asked ? onPress : undefined}
            style={{ width: 96, height: 84 + (t.who ? 8 : 0) + (t.waitingSince ? 16 : 0), borderRadius: 16, borderWidth: 1.5, borderColor: asked ? warn : eating ? ok : border, backgroundColor: asked ? alpha(warn, 0.14) : eating ? alpha(ok, 0.1) : surface, alignItems: 'center', justifyContent: 'center' }}
        >
            <Text style={{ color: text, fontWeight: '900', fontSize: 18 }}>{t.table}</Text>
            {t.state === 'free' ? <Text style={{ color: muted, fontSize: 11.5, marginTop: 2 }}>{tr('Free')}</Text> : (
                <>
                    <Text style={{ color: asked ? warn : ok, fontWeight: '900', fontSize: 12.5, marginTop: 2 }}>{t.state === 'bill_asked' ? tr('Bill asked') : t.check ? tr('Check') : rs(t.total)}</Text>
                    <Text style={{ color: muted, fontSize: 10.5 }}>{t.rounds} {t.rounds === 1 ? tr('round') : tr('rounds')} · {mins(t.since)} {tr('min')}</Text>
                    {t.who ? <Text numberOfLines={1} style={{ color: muted, fontSize: 10.5, maxWidth: 86 }}>{t.who}</Text> : null}
                    {t.waitingSince ? <WaitTimer since={t.waitingSince} compact style={{ marginTop: 3 }} /> : null}
                    {t.nudgedAt && Date.now() - new Date(t.nudgedAt).getTime() < 10 * 60000 ? <Ionicons name="notifications" size={13} color={warn} style={{ position: 'absolute', top: 5, right: 6 }} /> : null}
                </>
            )}
        </Pressable>
    );
    return <View style={{ marginRight: 8, marginBottom: 8 }}>{glow ? <GlowBorder active radius={16} width={2} colors={asked ? [warn, error] : [ok, ok]}>{inner}</GlowBorder> : inner}</View>;
}

export default function OwnerDineInScreen() {
    const nav = useNavigation();
    const { muted, text, primary, warn } = useBrand();
    const [v, setV] = useState(null);
    const [dirty, setDirty] = useState(false);
    const [prefsText, setPrefsText] = useState('');
    const [tipText, setTipText] = useState('');
    const [busy, setBusy] = useState(false);
    const [tables, setTables] = useState(null);
    const [open, setOpen] = useState(null);
    const [debts, setDebts] = useState([]);
    const loadDebts = useCallback(() => { fetchDineDebts().then((r) => setDebts(r.items)).catch(() => {}); }, []);
    const [qrSize, setQrSize] = useState('medium');
    const qr = async (what) => {
        try {
            if (what === 'share') { const r = await fetchDineQr(); await Share.share({ message: r.sample.url }); return; }
            const { html } = await fetchDineQrSheet(qrSize);
            if (what === 'print') await Print.printAsync({ html });
            else { const f = await Print.printToFileAsync({ html }); await Sharing.shareAsync(f.uri, { mimeType: 'application/pdf', dialogTitle: tr('Table QR stickers') }); }
        } catch (e) { showToast(apiError(e)); }
    };
    const blockFromList = async (x) => {
        const who = x.customers.find((c) => c.id);
        if (!who) return;
        const yes = await ask({ title: tr('Block this customer?'), message: tr('He will not be able to use the app of your shop. You can unblock him later from the Customers screen.'), confirmText: tr('Block'), cancelText: tr('No') });
        if (!yes) return;
        try { await blockCustomer(who.id, true, { reason: `Left table ${x.table} without paying`, sessionId: x.id }); showToast(tr('Customer blocked')); } catch (e) { showToast(apiError(e)); }
    };
    const clearDebt = async (x, method) => {
        try { await payDineDebt(x.id, method); showToast(tr('Marked as paid')); loadDebts(); } catch (e) { showToast(apiError(e)); }
    };

    useEffect(() => {
        fetchSettings().then((s) => {
            const o = Object.fromEntries(KEYS.map((k) => [k, s.orders.dineIn?.[k] ?? RECOMMENDED[k]]));
            setV(o); setPrefsText((o.prefs || []).join(', ')); setTipText((o.tipChoices || []).join(', '));
        }).catch((e) => showToast(apiError(e)));
    }, []);
    const loadTables = useCallback(() => { fetchDineTables().then((r) => setTables(r.items)).catch(() => setTables((x) => x || [])); }, []);
    useFocusEffect(useCallback(() => {
        loadTables(); loadDebts();
        const t = setInterval(loadTables, 20000);
        const a = onNotification(loadTables);
        const b = onOrderUpdate(loadTables);
        return () => { clearInterval(t); a(); b(); };
    }, [loadTables, loadDebts]));

    const mode = AUTO.every((k) => v?.[k]) ? 'auto' : AUTO.every((k) => !v?.[k]) ? 'manual' : 'custom';
    const applyMode = (m) => { setV((p) => ({ ...p, ...Object.fromEntries(AUTO.map((k) => [k, m === 'auto'])) })); setDirty(true); };
    const set = (k, x) => { setV((p) => ({ ...p, [k]: x })); setDirty(true); };
    const save = async () => {
        if (!Number.isInteger(v.tableCount) || v.tableCount < 1 || v.tableCount > 200) { showToast(tr('Tables: a whole number from 1 to 200')); return; }
        if (!Number.isInteger(v.autoCloseHours) || v.autoCloseHours < 1 || v.autoCloseHours > 48) { showToast(tr('Hours: from 1 to 48')); return; }
        for (const [k, lo, hi, m] of [['tabLimitNew', 0, 100000, 'Limit for new customers'], ['tabLimitTrusted', 0, 100000, 'Limit for regular customers'], ['trustedAfter', 1, 50, 'Regular after visits'], ['radiusM', 50, 5000, 'Distance'], ['cancelGraceMin', 0, 30, 'Minutes to cancel a round'], ['checkMinutes', 5, 240, 'Check after minutes'], ['readyMin', 1, 120, 'Average cooking time'], ['serveMin', 1, 120, 'Serve after minutes'], ['owedHour', 0, 23, 'Reminder hour'], ['owedMax', 1, 60, 'Stop reminders after'], ['referFriendPercent', 1, 100, 'Friend offer percent'], ['referFriendMax', 0, 100000, 'Friend offer limit'], ['referPoints', 1, 1000, 'Referral points'], ['referLimit', 1, 100, 'Referral limit'], ['waitMin', 0, 180, 'Waiting time'], ['welcomePercent', 1, 100, 'Welcome offer percent'], ['welcomeMax', 0, 100000, 'Welcome offer limit'], ['regularAfter', 1, 50, 'Regular after visits'], ['regularPercent', 1, 100, 'Regular offer percent'], ['regularMax', 0, 100000, 'Regular offer limit'], ['happyPercent', 1, 90, 'Happy hour percent'], ['happyMax', 0, 100000, 'Happy hour limit'], ['busyPercent', 10, 100, 'Busy when tables taken'], ['busyExtraMin', 5, 90, 'Extra waiting time']]) {
            if (!Number.isInteger(v[k]) || v[k] < lo || v[k] > hi) { showToast(`${tr(m)}: ${lo} - ${hi}`); return; }
        }
        if (v.happyOn && !(/^([01]\d|2[0-3]):[0-5]\d$/.test(v.happyFrom) && /^([01]\d|2[0-3]):[0-5]\d$/.test(v.happyTo))) { showToast(tr('Happy hour times must look like 15:00')); return; }
        setBusy(true);
        try { await saveSettings({ orders: { dineIn: Object.fromEntries(KEYS.map((k) => [k, k === 'prefs' ? parsePrefs(prefsText) : k === 'tipChoices' ? parseTips(tipText) : v[k]])) } }); setDirty(false); showToast(tr('Saved')); loadTables(); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    const recommended = () => { setV({ ...RECOMMENDED }); setPrefsText(RECOMMENDED.prefs.join(', ')); setTipText(RECOMMENDED.tipChoices.join(', ')); setDirty(true); showToast(tr('Recommended numbers are filled in. Press Save to keep them.')); };

    if (!v) return <FormPage title={tr('Dine in')}><ListShimmer count={2} /></FormPage>;
    const busyTables = (tables || []).filter((t) => t.state !== 'free');
    return (
        <FormPage title={tr('Dine in')} footer={<Button label={tr('Save')} icon="checkmark" busy={busy} disabled={!dirty} onPress={save} />}>
            {v.enabled ? (
                <View>
                    <SectionTitle title={tr('Tables now')} />
                    <Card>
                        {tables === null ? <ListShimmer count={1} rows /> : (
                            <View>
                                <Text style={{ color: muted, fontSize: 12.5, marginBottom: 10 }}>
                                    {busyTables.length ? tr('{n} of {total} tables in use. Tap a table for its bill.', { n: busyTables.length, total: tables.length }) : tr('No table is in use right now.')}
                                </Text>
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                                    {sortTables(tables).map((t) => <TableCell key={t.table} t={t} onPress={() => setOpen(t)} />)}
                                </View>
                            </View>
                        )}
                    </Card>
                </View>
            ) : null}

            {v.enabled ? (
                <Card onPress={() => nav.navigate('OwnerDineInReport')}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Ionicons name="stats-chart" size={22} color={primary} />
                        <View style={{ flex: 1, marginLeft: 12 }}>
                            <Text style={{ color: text, fontWeight: '900' }}>{tr('Dine in report')}</Text>
                            <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('Sales, busy hours, QR scans, unpaid bills and offers')}</Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={muted} />
                    </View>
                </Card>
            ) : null}
            <TableRequests />
            <GuestFeedback />

            {debts.length ? (
                <View>
                    <SectionTitle title={tr('Unpaid bills')} />
                    <Card>
                        {debts.map((x) => (
                            <View key={x.id} style={{ marginBottom: 12 }}>
                                <Text style={{ color: text, fontWeight: '900' }}>{rs(x.amount)} · {tr('Table {t}', { t: x.table })}</Text>
                                {x.claim ? (
                                    <Pressable onPress={() => useClaimPrompt.getState().reopen()} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                                        <Ionicons name="help-circle" size={16} color={warn} />
                                        <Text style={{ color: warn, fontWeight: '800', marginLeft: 4 }}>{tr('Says he paid. Tap to answer')}</Text>
                                    </Pressable>
                                ) : null}
                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{x.customers.map((c) => c.name || c.phone || tr('Customer')).join(', ')}</Text>
                                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                    {x.customers.find((c) => c.phone) ? <Button label={tr('Call')} icon="call" kind="ghost" onPress={() => Linking.openURL('tel:' + x.customers.find((c) => c.phone).phone)} style={{ flex: 1, marginRight: 8 }} /> : null}
                                    <Button label={tr('Cash Paid')} onPress={() => clearDebt(x, 'cash')} style={{ flex: 1, marginRight: 8 }} />
                                    <Button label={tr('Online Paid')} onPress={() => clearDebt(x, 'upi')} style={{ flex: 1 }} />
                                </View>
                                <Pressable onPress={() => blockFromList(x)} hitSlop={8} style={{ marginTop: 8 }}><Text style={{ color: muted, fontWeight: '800', fontSize: 12.5 }}>{tr('Block this customer')}</Text></Pressable>
                            </View>
                        ))}
                    </Card>
                </View>
            ) : null}

            {v.enabled ? (
                <Group title={tr('How do you want to run it?')} hint={tr('Automatic: dishes are marked ready and served by themselves, Busy mode tells guests when it is full, and unpaid bills are reminded every day. Manual: you press everything yourself. You can still change any single switch below.')}>
                    <View style={{ padding: 14 }}>
                        <View style={{ flexDirection: 'row' }}>
                            <Button label={tr('Automatic')} icon="flash" kind={mode === 'auto' ? 'primary' : 'ghost'} onPress={() => applyMode('auto')} style={{ flex: 1, marginRight: 8 }} />
                            <Button label={tr('Manual')} icon="hand-left" kind={mode === 'manual' ? 'primary' : 'ghost'} onPress={() => applyMode('manual')} style={{ flex: 1 }} />
                        </View>
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 10 }}>{mode === 'auto' ? tr('Now: Automatic') : mode === 'manual' ? tr('Now: Manual') : tr('Now: Custom (a mix of both)')}</Text>
                    </View>
                </Group>
            ) : null}
            <Group title={tr('Eating at your shop')} hint={tr('Customers at a table order from their phone, as many times as they like, and pay once at the end. Each order comes to you with the table number.')}>
                <ToggleRow title={tr('Take dine in orders')} subtitle={v.enabled ? tr('Customers see a Dine in choice on the Home screen') : tr('Switched off')} value={v.enabled} onValueChange={(x) => set('enabled', x)} last={!v.enabled} />
                {v.enabled ? (
                    <View>
                        <NumberBox label={tr('Number of tables')} integer value={v.tableCount} hint={`${tr('Recommended')}: ${RECOMMENDED.tableCount}. ${tr('Tables are numbered 1 to this number.')}`} onChange={(x) => set('tableCount', x ?? 1)} />
                        <NumberBox label={tr('A table with nothing owed closes after')} suffix={tr('hours')} integer value={v.autoCloseHours} hint={`${tr('Recommended')}: ${RECOMMENDED.autoCloseHours}. ${tr('A table that still owes money never closes by itself.')}`} onChange={(x) => set('autoCloseHours', x ?? 1)} last />
                    </View>
                ) : null}
            </Group>
            <Group title={tr('Walk-out protection')} hint={tr('Keeps you safe when customers pay at the end. Each number can be changed. 0 means no limit.')}>
                {v.enabled ? (
                    <View>
                        <ToggleRow title={tr('Customer must be at the shop')} subtitle={tr('Orders are accepted only from near your shop pin')} value={v.atShopCheck} onValueChange={(x) => set('atShopCheck', x)} />
                        {v.atShopCheck ? <NumberBox label={tr('How near')} suffix="m" integer value={v.radiusM} hint={`${tr('Recommended')}: ${RECOMMENDED.radiusM}`} onChange={(x) => set('radiusM', x ?? 250)} /> : null}
                        <ToggleRow title={tr('First visit must be paid online')} subtitle={v.firstOnline ? tr('A customer with no earlier paid visit cannot pay at the end') : tr('Off: everybody can pay at the end, within the limits below')} value={v.firstOnline} onValueChange={(x) => set('firstOnline', x)} />
                        <NumberBox label={tr('Unpaid limit, new customers')} suffix="₹" integer value={v.tabLimitNew} hint={`${tr('Recommended')}: ${RECOMMENDED.tabLimitNew}. ${tr('Above this he must pay online or pay first.')}`} onChange={(x) => set('tabLimitNew', x ?? 0)} />
                        <NumberBox label={tr('Unpaid limit, regular customers')} suffix="₹" integer value={v.tabLimitTrusted} hint={`${tr('Recommended')}: ${RECOMMENDED.tabLimitTrusted}`} onChange={(x) => set('tabLimitTrusted', x ?? 0)} />
                        <NumberBox label={tr('Regular after paid visits')} integer value={v.trustedAfter} hint={`${tr('Recommended')}: ${RECOMMENDED.trustedAfter}`} onChange={(x) => set('trustedAfter', x ?? 1)} />
                        <NumberBox label={tr('Tell me to check a table after')} suffix={tr('min')} integer value={v.checkMinutes} hint={`${tr('Recommended')}: ${RECOMMENDED.checkMinutes}. ${tr('Served, nobody asked for the bill.')}`} onChange={(x) => set('checkMinutes', x ?? 20)} last />
                    </View>
                ) : null}
            </Group>
            {v.enabled ? (
                <Group title={tr('Kitchen automation')} hint={tr('Less work for you. You can always press the buttons yourself: whatever you do first wins.')}>
                    <ToggleRow title={tr('Mark dishes ready by themselves')} subtitle={v.autoReady ? tr('Ready after the average cooking time below') : tr('Off: you press Ready each time')} value={v.autoReady} onValueChange={(x) => set('autoReady', x)} last={!v.autoReady} />
                    {v.autoReady ? <NumberBox label={tr('Average cooking time')} suffix={tr('min')} integer value={v.readyMin} hint={`${tr('Recommended')}: ${RECOMMENDED.readyMin}. ${tr('Customers are told this as the waiting time.')}`} onChange={(x) => set('readyMin', x ?? 15)} /> : null}
                    <ToggleRow title={tr('Mark dishes served by themselves')} subtitle={v.autoServe ? tr('Served some minutes after ready') : tr('Off: you press Served each time')} value={v.autoServe} onValueChange={(x) => set('autoServe', x)} last={!v.autoServe} />
                    {v.autoServe ? <NumberBox label={tr('Serve after')} suffix={tr('min')} integer value={v.serveMin} hint={`${tr('Recommended')}: ${RECOMMENDED.serveMin}. ${tr('Counted from Ready. The table bill can be settled only after dishes are served.')}`} onChange={(x) => set('serveMin', x ?? 10)} last /> : null}
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Guests at the table')} hint={tr('What guests can do from their phone while they eat.')}>
                    <ToggleRow title={tr('Guests can call the waiter')} subtitle={v.callOn ? tr('Water, spoon, clean the table... you see a list on Home') : tr('Off')} value={v.callOn} onValueChange={(x) => set('callOn', x)} />
                    <ToggleRow title={tr('Guests can add a tip for the waiter')} subtitle={v.tipOn ? tr('Added to the bill, collected at the counter') : tr('Off')} value={v.tipOn} onValueChange={(x) => set('tipOn', x)} last={!v.tipOn} />
                    {v.tipOn ? <TextBox label={tr('Tip amounts (₹, up to 4, separated by commas)')} value={tipText} onChangeText={(x) => { setTipText(x); setDirty(true); }} maxLength={30} placeholder="10, 20, 50" /> : null}
                    <ToggleRow title={tr('Ask for private feedback after the meal')} subtitle={v.feedbackOn ? tr('Only you read it. Happy guests are then asked to rate the dishes.') : tr('Off')} value={v.feedbackOn} onValueChange={(x) => set('feedbackOn', x)} last />
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Waiters')} hint={tr('If you have waiters with their own screen (Shop > Kitchen and waiter staff).')}>
                    <ToggleRow title={tr('Waiters can take the money for a bill')} subtitle={v.waiterSettles !== false ? tr('A waiter marks the bill paid by cash or UPI. You see who did it.') : tr('Only you can mark a bill paid. Waiters can still see the bill.')} value={v.waiterSettles !== false} onValueChange={(x) => set('waiterSettles', x)} last />
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Waiting time')} hint={tr('Customers see "Usually ready in about N min" before they order. When many tables are taken, Busy mode adds time on top.')}>
                    <NumberBox label={tr('Usual waiting time')} suffix={tr('min')} integer value={v.waitMin} hint={`${tr('Recommended')}: ${RECOMMENDED.waitMin}. ${tr('0 means do not show a waiting time.')}`} onChange={(x) => set('waitMin', x ?? 0)} />
                    <NumberBox label={tr('Guest can cancel a round himself for')} suffix={tr('min')} integer value={v.cancelGraceMin} hint={`${tr('Recommended')}: ${RECOMMENDED.cancelGraceMin}. ${tr('For an order made by mistake. After that he can only ask you. 0 means he can only ask.')}`} onChange={(x) => set('cancelGraceMin', x ?? 0)} last />
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Offers for diners')} hint={tr('They come by themselves, nobody types a code. One offer per order: the one that saves the customer the most. If the customer uses a coupon, the coupon is used instead.')}>
                    <ToggleRow title={tr('Welcome offer')} subtitle={v.welcomeOn ? tr('{a}% off the first table order, once per customer', { a: v.welcomePercent }) : tr('Off')} value={v.welcomeOn} onValueChange={(x) => set('welcomeOn', x)} last={!v.welcomeOn} />
                    {v.welcomeOn ? (
                        <View>
                            <NumberBox label={tr('Welcome offer: percent off')} suffix="%" integer value={v.welcomePercent} hint={`${tr('Recommended')}: ${RECOMMENDED.welcomePercent}`} onChange={(x) => set('welcomePercent', x ?? 10)} />
                            <NumberBox label={tr('Welcome offer: most he can save')} suffix="₹" integer value={v.welcomeMax} hint={`${tr('Recommended')}: ${RECOMMENDED.welcomeMax}. ${tr('0 means no limit.')}`} onChange={(x) => set('welcomeMax', x ?? 0)} last />
                        </View>
                    ) : null}
                    <ToggleRow title={tr('Regular customer offer')} subtitle={v.regularOn ? tr('{a}% off every table order after {b} paid visits', { a: v.regularPercent, b: v.regularAfter }) : tr('Off')} value={v.regularOn} onValueChange={(x) => set('regularOn', x)} last={!v.regularOn} />
                    {v.regularOn ? (
                        <View>
                            <NumberBox label={tr('Regular after this many paid visits')} integer value={v.regularAfter} hint={`${tr('Recommended')}: ${RECOMMENDED.regularAfter}`} onChange={(x) => set('regularAfter', x ?? 5)} />
                            <NumberBox label={tr('Regular offer: percent off')} suffix="%" integer value={v.regularPercent} hint={`${tr('Recommended')}: ${RECOMMENDED.regularPercent}`} onChange={(x) => set('regularPercent', x ?? 5)} />
                            <NumberBox label={tr('Regular offer: most he can save')} suffix="₹" integer value={v.regularMax} hint={`${tr('Recommended')}: ${RECOMMENDED.regularMax}. ${tr('0 means no limit.')}`} onChange={(x) => set('regularMax', x ?? 0)} last />
                        </View>
                    ) : null}
                    <ToggleRow title={tr('Happy hour')} subtitle={v.happyOn ? tr('{a}% off from {b} to {c} every day', { a: v.happyPercent, b: v.happyFrom, c: v.happyTo }) : tr('Off. A quiet time of day is a good time for it.')} value={v.happyOn} onValueChange={(x) => set('happyOn', x)} last={!v.happyOn} />
                    {v.happyOn ? (
                        <View>
                            <TextBox label={tr('From (24-hour, like 15:00)')} value={v.happyFrom} onChangeText={(x) => set('happyFrom', x)} maxLength={5} placeholder="15:00" />
                            <TextBox label={tr('To (24-hour, like 18:00)')} value={v.happyTo} onChangeText={(x) => set('happyTo', x)} maxLength={5} placeholder="18:00" />
                            <NumberBox label={tr('Happy hour: percent off')} suffix="%" integer value={v.happyPercent} hint={`${tr('Recommended')}: ${RECOMMENDED.happyPercent}`} onChange={(x) => set('happyPercent', x ?? 15)} />
                            <NumberBox label={tr('Happy hour: most he can save')} suffix="₹" integer value={v.happyMax} hint={`${tr('Recommended')}: ${RECOMMENDED.happyMax}. ${tr('0 means no limit.')}`} onChange={(x) => set('happyMax', x ?? 0)} last />
                        </View>
                    ) : null}
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Refer a friend')} hint={tr('A guest shares a code. The friend gets an offer on his first table order. When that first meal is paid, the guest who referred him gets points (needs Rewards switched on).')}>
                    <ToggleRow title={tr('Refer a friend')} subtitle={v.referOn ? tr('{a}% off for the friend, {b} points for the guest', { a: v.referFriendPercent, b: v.referPoints }) : tr('Off')} value={v.referOn} onValueChange={(x) => set('referOn', x)} last={!v.referOn} />
                    {v.referOn ? (
                        <View>
                            <NumberBox label={tr('Friend: percent off the first table order')} suffix="%" integer value={v.referFriendPercent} hint={`${tr('Recommended')}: ${RECOMMENDED.referFriendPercent}`} onChange={(x) => set('referFriendPercent', x ?? 15)} />
                            <NumberBox label={tr('Friend: most he can save')} suffix="₹" integer value={v.referFriendMax} hint={`${tr('Recommended')}: ${RECOMMENDED.referFriendMax}. ${tr('0 means no limit.')}`} onChange={(x) => set('referFriendMax', x ?? 0)} />
                            <NumberBox label={tr('Points for the guest who referred')} integer value={v.referPoints} hint={`${tr('Recommended')}: ${RECOMMENDED.referPoints}`} onChange={(x) => set('referPoints', x ?? 50)} />
                            <NumberBox label={tr('Most friends who earn points for one guest')} integer value={v.referLimit} hint={`${tr('Recommended')}: ${RECOMMENDED.referLimit}. ${tr('After that, friends still get their offer.')}`} onChange={(x) => set('referLimit', x ?? 10)} last />
                        </View>
                    ) : null}
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Food choices')} hint={tr('Quick taps a customer sees when ordering at a table, so you know before the food goes out. They can also write their own. Separate the choices with commas.')}>
                    <TextBox label={tr('Choices')} value={prefsText} onChangeText={(x) => { setPrefsText(x); setDirty(true); }} multiline maxLength={400} last />
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Unpaid bills')} hint={tr('Customers who leave without paying. They are blocked from ordering until they pay.')}>
                    <ToggleRow title={tr('Show them on my Home screen')} subtitle={v.owedOnHome ? tr('A card on Home until every bill is paid') : tr('Hidden. They are still in Orders, Unpaid bills')} value={v.owedOnHome} onValueChange={(x) => set('owedOnHome', x)} />
                    <ToggleRow title={tr('Remind them every day')} subtitle={v.owedDaily ? tr('Everyone who owes gets a reminder once a day') : tr('Off: you remind them yourself')} value={v.owedDaily} onValueChange={(x) => set('owedDaily', x)} last={!v.owedDaily} />
                    {v.owedDaily ? <NumberBox label={tr('Remind at this hour (0 to 23)')} integer value={v.owedHour} hint={`${tr('Recommended')}: ${RECOMMENDED.owedHour}. ${tr('11 means 11 AM. 18 means 6 PM.')}`} onChange={(x) => set('owedHour', x ?? 11)} /> : null}
                    {v.owedDaily ? <NumberBox label={tr('Stop the daily reminders after')} suffix={tr('reminders')} integer value={v.owedMax} hint={`${tr('Recommended')}: ${RECOMMENDED.owedMax}. ${tr('You can still remind by hand.')}`} onChange={(x) => set('owedMax', x ?? 7)} last /> : null}
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Busy mode')} hint={tr('When many tables are taken, new customers are told the food may take longer, and their waiting time grows. It stops by itself when tables free up.')}>
                    <ToggleRow title={tr('Tell customers when we are busy')} subtitle={v.busyAuto ? tr('Automatic') : tr('Off')} value={v.busyAuto} onValueChange={(x) => set('busyAuto', x)} last={!v.busyAuto} />
                    {v.busyAuto ? (
                        <View>
                            <NumberBox label={tr('Busy when this many tables are taken')} suffix="%" integer value={v.busyPercent} hint={`${tr('Recommended')}: ${RECOMMENDED.busyPercent}`} onChange={(x) => set('busyPercent', x ?? 70)} />
                            <NumberBox label={tr('Extra waiting time then')} suffix={tr('min')} integer value={v.busyExtraMin} hint={`${tr('Recommended')}: ${RECOMMENDED.busyExtraMin}`} onChange={(x) => set('busyExtraMin', x ?? 10)} last />
                        </View>
                    ) : null}
                </Group>
            ) : null}
            {v.enabled ? (
                <Group title={tr('Table QR stickers')} hint={tr('Each table has its own QR. A customer scans it with the phone camera: the app opens on that table (or the Play Store, if the app is not installed). The QR is signed, so nobody can make a fake one.')}>
                    <View style={{ padding: 14 }}>
                        <Text style={{ color: text, fontWeight: '900', marginBottom: 8 }}>{tr('Sticker size')}</Text>
                        <View style={{ flexDirection: 'row', marginBottom: 12 }}>
                            {[['small', 'Small (many on a page)'], ['medium', 'Medium (6 per page)'], ['large', 'Large (one per page)']].map(([k, l]) => (
                                <Pressable key={k} onPress={() => setQrSize(k)} style={{ flex: 1, marginRight: k === 'large' ? 0 : 8, paddingVertical: 10, paddingHorizontal: 6, borderRadius: 12, borderWidth: 1.5, borderColor: qrSize === k ? primary : alpha(muted, 0.4), backgroundColor: qrSize === k ? alpha(primary, 0.12) : 'transparent' }}>
                                    <Text style={{ color: qrSize === k ? primary : text, fontWeight: '800', fontSize: 12, textAlign: 'center' }}>{tr(l)}</Text>
                                </Pressable>
                            ))}
                        </View>
                        <Button label={tr('Print stickers')} icon="print" onPress={() => qr('print')} />
                        <Button label={tr('Share stickers as PDF')} icon="document" kind="ghost" onPress={() => qr('pdf')} style={{ marginTop: 10 }} />
                        <Button label={tr('Share a test link (Table 1)')} icon="share-social" kind="ghost" onPress={() => qr('share')} style={{ marginTop: 10 }} />
                    </View>
                </Group>
            ) : null}
            <View style={{ paddingHorizontal: 16 }}>
                <Button label={tr('Use recommended settings')} icon="refresh" kind="ghost" disabled={busy} onPress={recommended} />
                <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('Coming here next: offers, waiting time and table service.')}</Text>
            </View>
            <BillSheet table={open} onClose={() => setOpen(null)} onDone={() => { loadTables(); loadDebts(); }} />
        </FormPage>
    );
}
