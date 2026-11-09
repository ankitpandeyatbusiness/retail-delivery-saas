// Automations: every automatic thing the app does for the shop, in sections, with a search box. Each row is
//   a switch or a choice  (you decide; it saves the moment it changes),
//   "Always on"           (the system does it by itself and the timing is fixed: it is listed so nothing is hidden), or
//   "Set by the platform" (a number only the platform can change, shown read-only).
// "Recommended settings" puts every setting here back to what we recommend; "All by hand" switches the automatic things off.
// The settings live where they always did (auto accept, dine in, delivery rules, booking, Autopilot) and in the shop's automation row (services/automations.js).
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable, TextInput } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { Button, Card, Empty } from '../../components/owners/ui';
import { FormPage, ToggleRow, ChoiceBox } from '../../components/owners/menuBits';
import { AutoAcceptCard } from '../../components/owners/AutoAccept';
import { FormShimmer } from '../../components/owners/shimmer';
import { fetchSettings, saveSettings, booking as bookingApi, automations as autoApi, fetchAutopilot, saveAutopilot, apiError } from '../../api/owners/shopApi';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ease } from '../../utils/common/ease';
import { tr } from '../../i18n';

const mins = (n) => (n >= 60 && n % 60 === 0 ? (n === 60 ? tr('1 hour') : tr('{n} hours', { n: n / 60 })) : tr('{n} minutes', { n }));
const opts = (list) => list.map((n) => (n === 0 ? [0, tr('Off')] : [n, mins(n)]));
const days = () => [[0, tr('Off')], [3, tr('{n} days', { n: 3 })], [7, tr('{n} days', { n: 7 })], [14, tr('{n} days', { n: 14 })]];
const hoursOf = (cur) => [3, 6, 12, 24].concat([3, 6, 12, 24].includes(cur) || !cur ? [] : [cur]).sort((x, y) => x - y).map((h) => [h, tr('{n} hours', { n: h })]);
const withValue = (list, v) => (v === undefined || v === null || list.some((x) => x[0] === v) ? list : [...list, [v, mins(v)]].sort((a, b) => a[0] - b[0]));
// minutes choices that always keep the current value in the list
const minList = (list, cur) => list.concat(list.includes(cur) || cur === undefined || cur === null ? [] : [cur]).sort((x, y) => x - y).map((n) => [n, tr('{n} minutes', { n })]);

// the sections, in the order they show
const SECTIONS = [
    ['orders', 'New orders'], ['delivery', 'Delivery and riders'], ['kitchen', 'Kitchen'], ['tables', 'Tables and dine in'], ['bills', 'Unpaid bills'],
    ['pickup', 'Pickup orders'], ['reservations', 'Reservations'], ['inquiries', 'Inquiries and complaints'], ['customers', 'Messages to customers'], ['staff', 'Staff'], ['platform', 'Done by the platform for you'],
];

export default function OwnerAutomationsScreen() {
    const nav = useNavigation();
    const { muted, text, primary, border, surface } = useBrand();
    const bookingOn = useMenuFlags((s) => s.bookingOn);
    const servicesOn = useMenuFlags((s) => s.servicesOn);
    // What the plan includes: a rule whose feature is not in the plan is not shown at all (the server also keeps it off). No plan yet = nothing is hidden.
    const plan = useMenuFlags((s) => s.plan);
    const has = (k) => !plan || plan.features?.[k] !== false;
    useEffect(() => { useMenuFlags.getState().refresh(); }, []);
    const [a, setA] = useState(null);          // the shop's own automations (services/automations.js)
    const [dine, setDine] = useState(null);    // settings.orders.dineIn
    const [rid, setRid] = useState(null);      // settings.riders
    const [staff, setStaff] = useState(null);  // settings.orders.staff (set by the platform: shown only)
    const [bk, setBk] = useState(null);        // booking settings
    const [ap, setAp] = useState(null);        // Autopilot
    const [err, setErr] = useState('');
    const [q, setQ] = useState('');

    const load = useCallback(async () => {
        try {
            const [auto, st, b, p] = await Promise.all([autoApi.get(), fetchSettings(), bookingOn ? bookingApi.settings().catch(() => null) : null, fetchAutopilot().catch(() => null)]);
            setA(auto); setDine(st.orders?.dineIn || {}); setRid(st.riders || {}); setStaff(st.orders?.staff || {}); setBk(b); setAp(p);
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open Automations.')); }
    }, [bookingOn]);
    useEffect(() => { load(); }, [load]);

    // each change shows at once and is saved; if it cannot be saved it goes back
    const saveA = async (patch) => { const before = a; ease(); setA({ ...a, ...patch }); try { setA(await autoApi.save(patch)); } catch (e) { setA(before); showToast(apiError(e)); } };
    const saveDine = async (patch) => { const before = dine; ease(); setDine({ ...dine, ...patch }); try { await saveSettings({ orders: { dineIn: patch } }); } catch (e) { setDine(before); showToast(apiError(e)); } };
    const saveRid = async (patch) => { const before = rid; ease(); setRid({ ...rid, ...patch }); try { await saveSettings({ riders: patch }); } catch (e) { setRid(before); showToast(apiError(e)); } };
    const saveBk = async (patch) => { const before = bk; ease(); setBk({ ...bk, ...patch }); try { await bookingApi.saveSettings(patch); } catch (e) { setBk(before); showToast(apiError(e)); } };
    const saveAp = async (key, v) => { const before = ap; ease(); setAp({ ...ap, on: { ...ap.on, [key]: v } }); try { setAp(await saveAutopilot({ on: { [key]: v } })); } catch (e) { setAp(before); showToast(apiError(e)); } };

    // every setting here back to what we recommend (your own auto-accept hours are yours, so they stay)
    const recommended = async () => {
        const yes = await ask({ title: tr('Use the recommended settings?'), message: tr('Every automation on this screen goes back to what we recommend. Your auto-accept hours stay as they are.'), confirmText: tr('Use recommended settings') });
        if (!yes) return;
        try {
            setA(await autoApi.reset());
            await saveSettings({ orders: { dineIn: { autoReady: true, readyMin: 15, autoServe: true, serveMin: 10, busyAuto: true, autoCloseHours: 6, owedDaily: true, owedHour: 11, owedMax: 7, checkMinutes: 20, guestWatch: true, unreachableMin: 10, cancelGraceMin: 3 } }, riders: { assignMode: 'automatic', offerSeconds: 120 } });
            if (bookingOn) await bookingApi.saveSettings({ autoAllow: false, holdMinutes: 10 });
            if (ap) await saveAutopilot({ recommended: true });
            await load();
            showToast(tr('Back to the recommended settings'));
        } catch (e) { showToast(apiError(e)); }
    };
    const byHand = async () => {
        const yes = await ask({ title: tr('Do everything by hand?'), message: tr('The automatic things on this screen go off. Nothing is done for you, and you will not get automatic reminders. Picking a rider stays as it is.'), confirmText: tr('Everything by hand') });
        if (!yes) return;
        try {
            setA(await autoApi.save({ reservationAutoAllowMin: 0, reservationNoShowMin: 0, depositAutoAdjust: false, pickupNotCollectedMin: 0, cancelRequestDeclineMin: 0, inquiryCloseDays: 0, stageAlerts: false, cashLimitReminders: false, leaveReminders: false, kitchenProblemReminders: false, complaintReminders: false, closedDayReminders: false, autoApproveLeave: false }));
            await saveSettings({ orders: { dineIn: { autoReady: false, autoServe: false, busyAuto: false, owedDaily: false, guestWatch: false } } });
            if (bookingOn) await bookingApi.saveSettings({ autoAllow: false });
            if (ap) await saveAutopilot({ on: Object.fromEntries(Object.keys(ap.on || {}).map((k) => [k, false])) });
            await load();
            showToast(tr('Everything is by hand now'));
        } catch (e) { showToast(apiError(e)); }
    };

    // ---- the rows. kind: toggle | choice | info | link | custom. words: extra words the search looks through.
    const rows = useMemo(() => {
        if (!a || !dine || !rid) return [];
        const dineOn = dine.enabled !== false;
        const R = [];
        const T = (id, section, title, sub, value, onChange, words = '', show = true) => { if (show) R.push({ id, section, kind: 'toggle', title, sub, value, onChange, words }); };
        const C = (id, section, label, options, value, onChange, words = '', note = '', show = true) => { if (show) R.push({ id, section, kind: 'choice', title: label, options, value, onChange, words, note }); };
        const I = (id, section, title, sub, words = '', tag = tr('Always on'), show = true) => { if (show) R.push({ id, section, kind: 'info', title, sub, words, tag }); };

        // new orders
        if (has('autoAccept')) R.push({ id: 'autoaccept', section: 'orders', kind: 'custom', title: tr('Accept new orders by themselves'), words: 'auto accept busy hours schedule', node: <AutoAcceptCard /> });
        I('accept10', 'orders', tr('An order nobody accepts is cancelled'), tr('After 10 minutes, with a full refund and no penalty for you. You get reminders at 3 and 6 minutes.'), 'cancel not accepted timeout refund reminder');
        I('sms3', 'orders', tr('An unread new-order alert gets an SMS'), tr('After about 3 minutes, so a missed order is not lost.'), 'sms escalation unread');
        I('unpaid15', 'orders', tr('An online order the customer never paid is cancelled'), tr('After 15 minutes. If the money arrives later it goes back.'), 'online unpaid payment timeout cancel refund');
        // delivery and riders
        C('assign', 'delivery', tr('How is a rider picked'), [['automatic', tr('Automatic')], ['manual', tr('I choose')]], rid.assignMode || 'automatic', (x) => saveRid({ assignMode: x }), 'rider assign pick automatic manual');
        C('offer', 'delivery', tr('Time a rider has to answer'), [[60, tr('1 minute')], [90, tr('90 seconds')], [120, tr('2 minutes')], [180, tr('3 minutes')]].concat([60, 90, 120, 180].includes(rid.offerSeconds) || !rid.offerSeconds ? [] : [[rid.offerSeconds, tr('{n} seconds', { n: rid.offerSeconds })]]), rid.offerSeconds || 120, (x) => saveRid({ offerSeconds: x }), 'rider offer answer time next rider', '', rid.assignMode !== 'manual');
        T('cashrem', 'delivery', tr('A rider holds too much cash'), a.cashLimitReminders ? tr('Every few hours until you record the handover') : tr('Off'), !!a.cashLimitReminders, (x) => saveA({ cashLimitReminders: x }), 'rider cash limit handover reminder');
        T('stage', 'delivery', tr('An order stays too long in one stage'), a.stageAlerts ? tr('Cooking over an hour, or ready with no rider') : tr('Off'), !!a.stageAlerts, (x) => saveA({ stageAlerts: x }), 'slow stuck order no rider ready reminder alert');
        I('late', 'delivery', tr('A very late delivery is cancelled'), tr('The rider and you are warned 50 minutes after it was due, and it is cancelled with a refund after 60 minutes.'), 'late delivery cancel warn refund');
        // kitchen
        T('ready', 'kitchen', tr('Mark dishes ready by themselves'), dine.autoReady ? tr('Ready after the cooking time') : tr('Off: you press Ready each time'), !!dine.autoReady, (x) => saveDine({ autoReady: x }), 'kitchen cook ready automatic', dineOn);
        C('readymin', 'kitchen', tr('Average cooking time'), withValue(opts([10, 15, 20, 30, 45]), dine.readyMin), dine.readyMin ?? 15, (x) => saveDine({ readyMin: x }), 'cooking time ready waiting time', '', dineOn && !!dine.autoReady);
        T('serve', 'kitchen', tr('Mark dishes served by themselves'), dine.autoServe ? tr('Served some minutes after ready') : tr('Off: you press Served each time'), !!dine.autoServe, (x) => saveDine({ autoServe: x }), 'waiter served automatic', dineOn);
        C('servemin', 'kitchen', tr('Serve after'), withValue(opts([5, 10, 15]), dine.serveMin), dine.serveMin ?? 10, (x) => saveDine({ serveMin: x }), 'served after ready', '', dineOn && !!dine.autoServe);
        T('kp', 'kitchen', tr('The kitchen reported a problem'), a.kitchenProblemReminders ? tr('Every 10 minutes until you answer') : tr('Off'), !!a.kitchenProblemReminders, (x) => saveA({ kitchenProblemReminders: x }), 'kitchen problem finished dish reminder');
        if (staff) I('nudge', 'kitchen', tr('Nudges to the cooks'), tr('An accepted order nobody started after {a} minutes, and one still cooking {b} minutes late. Set by the platform.', { a: staff.nudgeMin ?? '-', b: staff.lateMin ?? '-' }), 'kitchen cook nudge late start', tr('Set by the platform'));
        // tables and dine in
        T('busy', 'tables', tr('Tell customers when we are busy'), dine.busyAuto ? tr('Automatic, when many tables are taken') : tr('Off'), !!dine.busyAuto, (x) => saveDine({ busyAuto: x }), 'busy mode waiting time crowded', dineOn);
        C('close', 'tables', tr('A table with nothing owed closes after'), hoursOf(dine.autoCloseHours), dine.autoCloseHours || 6, (x) => saveDine({ autoCloseHours: x }), 'table close quiet open hours', '', dineOn);
        C('cancelreq', 'tables', tr('A guest asks to cancel a dish being made'), opts([0, 3, 5, 10]), a.cancelRequestDeclineMin, (x) => saveA({ cancelRequestDeclineMin: x }), 'cancel request round dish already made decline', tr('If it is already being made, the request is declined after this time. A dish not started yet is left to you.'), dineOn);
        C('grace', 'tables', tr('A guest can cancel a round himself for'), [0, 2, 3, 5, 10].concat([0, 2, 3, 5, 10].includes(dine.cancelGraceMin) || dine.cancelGraceMin === undefined ? [] : [dine.cancelGraceMin]).sort((x, y) => x - y).map((n) => (n === 0 ? [0, tr('Off')] : [n, tr('{n} minutes', { n })])), dine.cancelGraceMin ?? 3, (x) => saveDine({ cancelGraceMin: x }), 'guest cancel round mistake grace', tr('For an order made by mistake. After that he can only ask you.'), dineOn);
        C('check', 'tables', tr('Tell me to check a table after'), minList([10, 20, 30, 45], dine.checkMinutes), dine.checkMinutes ?? 20, (x) => saveDine({ checkMinutes: x }), 'check table finished eating bill nobody asked', tr('Served, and nobody asked for the bill.'), dineOn);
        T('watch', 'tables', tr('Tell me when a guest who owes cannot be reached'), dine.guestWatch !== false ? tr('Their phone has not been heard from for a while, or their location is switched off.') : tr('Off: nothing is watched.'), dine.guestWatch !== false, (x) => saveDine({ guestWatch: x }), 'guest owes unreachable walk out phone location', dineOn);
        C('unreach', 'tables', tr('Not reachable after'), minList([5, 10, 20, 30], dine.unreachableMin), dine.unreachableMin ?? 10, (x) => saveDine({ unreachableMin: x }), 'guest unreachable minutes', '', dineOn && dine.guestWatch !== false);
        I('join2', 'tables', tr('A guest who asked to join a shared table'), tr('If nobody answers in 2 minutes, he is offered his own bill.'), 'shared table join request', tr('Always on'), dineOn);
        I('billask', 'tables', tr('A table that asked for the bill'), tr('You and the waiters are reminded every few minutes, up to 6 times, until it is settled.'), 'bill asked reminder waiter', tr('Always on'), dineOn);
        // unpaid bills
        T('owed', 'bills', tr('Remind them every day'), dine.owedDaily ? tr('Everyone who owes gets a reminder once a day') : tr('Off: you remind them yourself'), !!dine.owedDaily, (x) => saveDine({ owedDaily: x }), 'unpaid bill owe reminder daily walk out', dineOn);
        C('owedhour', 'bills', tr('Remind at'), [[9, '9 AM'], [11, '11 AM'], [14, '2 PM'], [17, '5 PM'], [19, '7 PM']].concat([9, 11, 14, 17, 19].includes(dine.owedHour) || dine.owedHour === undefined ? [] : [[dine.owedHour, `${dine.owedHour}:00`]]), dine.owedHour ?? 11, (x) => saveDine({ owedHour: x }), 'unpaid reminder hour', '', dineOn && !!dine.owedDaily);
        C('owedmax', 'bills', tr('Stop the daily reminders after'), [3, 5, 7, 10, 14].concat([3, 5, 7, 10, 14].includes(dine.owedMax) || dine.owedMax === undefined ? [] : [dine.owedMax]).sort((x, y) => x - y).map((n) => [n, tr('{n} reminders', { n })]), dine.owedMax ?? 7, (x) => saveDine({ owedMax: x }), 'unpaid reminder stop how many', '', dineOn && !!dine.owedDaily);
        // pickup
        C('pickup', 'pickup', tr('A ready order nobody collected is marked not collected'), [[0, tr('Off')], [30, tr('30 minutes after the pickup time ends')], [60, tr('1 hour after')], [120, tr('2 hours after')]], a.pickupNotCollectedMin, (x) => saveA({ pickupNotCollectedMin: x }), 'pickup not collected no show customer did not come', tr('The customer is counted as at fault, like when you mark it yourself.'));
        I('pickrem', 'pickup', tr('Reminders to the customer'), tr('30 minutes before the pickup time ends, when it ends, and you are told 30 minutes after if he has not come.'), 'pickup reminder customer waiting');
        // reservations
        if (bookingOn && bk) {
            T('allow', 'reservations', tr('Allow paid reservations at once'), bk.autoAllow ? tr('Confirmed the moment the deposit is paid') : tr('Off: you tap Allow, or it is allowed after the time below'), !!bk.autoAllow, (x) => saveBk({ autoAllow: x }), 'reservation allow confirm deposit paid auto');
            C('allowafter', 'reservations', tr('A reservation you did not answer is allowed after'), opts([0, 15, 30, 60]), a.reservationAutoAllowMin, (x) => saveA({ reservationAutoAllowMin: x }), 'reservation not answered allow after', '', !bk.autoAllow);
            C('noshow', 'reservations', tr('A guest who did not come is marked no-show after'), opts([0, 15, 30, 45, 60]), a.reservationNoShowMin, (x) => saveA({ reservationNoShowMin: x }), 'reservation no show did not come deposit kept', tr('Counted from the start time. A guest who is already eating at his table is marked seated instead, so his deposit is safe.'));
            T('adjust', 'reservations', tr('Mark the deposit taken off the bill'), a.depositAutoAdjust ? tr("When the guest's table bill is closed") : tr('Off: you mark it yourself'), !!a.depositAutoAdjust, (x) => saveA({ depositAutoAdjust: x }), 'reservation deposit bill adjust');
            C('hold', 'reservations', tr('An unpaid reservation is let go after'), minList([5, 10, 15, 20, 30], bk.holdMinutes || 10), bk.holdMinutes || 10, (x) => saveBk({ holdMinutes: x }), 'reservation hold unpaid release table');
            T('closedday', 'reservations', tr('Remind me about reservations on a closed day'), a.closedDayReminders ? tr('Once a day, until you cancel or keep them') : tr('Off'), !!a.closedDayReminders, (x) => saveA({ closedDayReminders: x }), 'reservation closed day holiday day off cancel refund reminder');
            I('resrem', 'reservations', tr('Reminders and refunds'), tr('You and the guest are reminded 30 minutes before. A guest on the waitlist is told when a table frees up. A refund that failed is tried again.'), 'reservation reminder waitlist refund retry');
        }
        // inquiries and complaints
        C('inqclose', 'inquiries', tr('An answered inquiry with no new message is ended after'), days(), a.inquiryCloseDays, (x) => saveA({ inquiryCloseDays: x }), 'inquiry quiet end close services', '', servicesOn);
        I('inqrem', 'inquiries', tr('An inquiry nobody answered'), tr('You are reminded after a day. It stays open until you reply.'), 'inquiry reminder unanswered', tr('Always on'), servicesOn);
        T('compl', 'inquiries', tr('Remind me about a complaint nobody answered'), a.complaintReminders ? tr('Every day, up to 3 times') : tr('Off'), !!a.complaintReminders, (x) => saveA({ complaintReminders: x }), 'complaint reminder unanswered');
        // messages to customers (Autopilot)
        if (ap?.on) {
            const AP = [['winback', 'Bring back customers who stopped ordering', 'win back lapsed customers offer'], ['welcome', 'Welcome after the first order', 'welcome new customer first order'], ['mealtime', 'Meal-time reminder', 'meal time lunch dinner reminder regular'], ['festival', 'Festival greetings', 'festival diwali greetings'], ['dailySummary', 'Daily summary for you', 'daily summary report'], ['weeklyDigest', 'Monday digest for you', 'weekly digest monday report']];
            for (const [k, title, words] of AP) T(`ap-${k}`, 'customers', tr(title), ap.on[k] ? tr('On') : tr('Off'), !!ap.on[k], (x) => saveAp(k, x), `autopilot ${words}`);
            R.push({ id: 'aplink', section: 'customers', kind: 'link', title: tr('Autopilot details'), sub: tr('Messages, language, how often, quiet hours and the offer limit'), words: 'autopilot settings frequency language quiet', go: () => nav.navigate('OwnerAutopilot') });
        }
        // staff
        T('leaverem', 'staff', tr('A leave request nobody answered'), a.leaveReminders ? tr('After 2 hours, and again later') : tr('Off'), !!a.leaveReminders, (x) => saveA({ leaveReminders: x }), 'staff rider leave request reminder');
        T('leaveauto', 'staff', tr('Approve a staff leave request nobody answered'), a.autoApproveLeave ? tr('Approved after 2 hours') : tr('Off: you decide'), !!a.autoApproveLeave, (x) => saveA({ autoApproveLeave: x }), 'staff leave approve automatic');
        // done by the platform
        I('p1', 'platform', tr('Backups of your shop data'), tr('Taken every day, and kept for a week. A weekly copy is kept for a month.'), 'backup data safe', tr('Done for you'));
        I('p2', 'platform', tr('Monthly reports'), tr('Made at the start of each month.'), 'monthly report', tr('Done for you'));
        I('p3', 'platform', tr('Loyalty points'), tr('Points a customer earned are released by themselves after the order is safe.'), 'loyalty points release rewards', tr('Done for you'));
        // a rule whose feature is not in the plan is left out (the same rules the server uses: services/automations.js)
        const NEEDS = { kp: 'staffLogins', nudge: 'staffLogins', leaveauto: 'staffLogins', p2: 'analytics', p3: 'loyalty', autoaccept: 'autoAccept' };
        return R.filter((r) => !NEEDS[r.id] || has(NEEDS[r.id]));
    }, [a, dine, rid, staff, bk, ap, bookingOn, servicesOn, plan]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!a || !dine || !rid) return <FormPage title={tr('Automations')}>{err ? <Text style={{ color: muted, padding: 20 }}>{err}</Text> : <FormShimmer cards={4} />}</FormPage>;

    const needle = q.trim().toLowerCase();
    const matches = (r) => !needle || `${r.title} ${r.sub || ''} ${r.note || ''} ${r.words || ''} ${tr(SECTIONS.find((s) => s[0] === r.section)?.[1] || '')}`.toLowerCase().includes(needle);
    const shown = rows.filter(matches);

    const renderRow = (r, last) => {
        if (r.kind === 'toggle') return <ToggleRow key={r.id} title={r.title} subtitle={r.sub} value={r.value} onValueChange={r.onChange} last={last} />;
        if (r.kind === 'choice') return (
            <View key={r.id}>
                <ChoiceBox label={r.title} options={r.options} value={r.value} onChange={r.onChange} last={last && !r.note} />
                {r.note ? <Text style={{ color: muted, fontSize: 12, marginTop: 4, marginBottom: last ? 0 : 14 }}>{r.note}</Text> : null}
            </View>
        );
        if (r.kind === 'link') return (
            <Pressable key={r.id} onPress={r.go} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}>
                <Ionicons name="rocket" size={20} color={primary} />
                <View style={{ flex: 1, marginHorizontal: 12 }}>
                    <Text style={{ color: text, fontWeight: '800', fontSize: 14.5 }}>{r.title}</Text>
                    <Text style={{ color: muted, fontSize: 12.5 }}>{r.sub}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={muted} />
            </Pressable>
        );
        if (r.kind === 'info') return (
            <View key={r.id} style={{ paddingVertical: 8, borderBottomWidth: last ? 0 : 0.5, borderBottomColor: border }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Text style={{ flex: 1, color: text, fontWeight: '800', fontSize: 14.5 }}>{r.title}</Text>
                    <View style={{ marginLeft: 8, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 9, backgroundColor: alpha(primary, 0.12) }}><Text style={{ color: primary, fontSize: 11, fontWeight: '800' }}>{tr(r.tag)}</Text></View>
                </View>
                <Text style={{ color: muted, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>{r.sub}</Text>
            </View>
        );
        return null;
    };

    return (
        <FormPage title={tr('Automations')}>
            <Text style={{ color: muted, fontSize: 13, paddingHorizontal: 18, marginBottom: 8, lineHeight: 19 }}>{tr('What is switched on is done for you after the time you choose, and you are told afterwards. What is off, you do by hand. Whatever you do first always wins.')}</Text>
            <View style={{ marginHorizontal: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', height: 46, borderWidth: 1, borderColor: border, backgroundColor: surface, borderRadius: 14, paddingHorizontal: 12 }}>
                <Ionicons name="search" size={18} color={muted} />
                <TextInput value={q} onChangeText={(x) => { ease(); setQ(x); }} placeholder={tr('Search automations')} placeholderTextColor={muted} autoCorrect={false} autoCapitalize="none" style={{ flex: 1, height: 46, color: text, fontSize: 15, paddingHorizontal: 8, paddingVertical: 0, textAlignVertical: 'center', includeFontPadding: false }} />
                {q ? <Pressable onPress={() => { ease(); setQ(''); }} hitSlop={8}><Ionicons name="close-circle" size={18} color={muted} /></Pressable> : null}
            </View>
            {!needle ? (
                <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 6 }}>
                    <Button label={tr('Recommended settings')} icon="sparkles" kind="ghost" onPress={recommended} style={{ flex: 3, marginRight: 8 }} />
                    <Button label={tr('All by hand')} icon="hand-left" kind="ghost" onPress={byHand} style={{ flex: 2 }} />
                </View>
            ) : null}
            {needle && !shown.length ? <Empty icon="search-outline" title={tr('Nothing found')} hint={tr('Try another word, like refund, reminder, no-show or rider.')} /> : null}
            {SECTIONS.map(([key, title]) => {
                const list = shown.filter((r) => r.section === key);
                if (!list.length) return null;
                return (
                    <View key={key} style={{ marginBottom: 4 }}>
                        <Text style={{ color: text, fontSize: 16, fontWeight: '900', paddingHorizontal: 16, marginTop: 10, marginBottom: 8 }}>{tr(title)}</Text>
                        {list.filter((r) => r.kind === 'custom').map((r) => <View key={r.id}>{r.node}</View>)}
                        {list.some((r) => r.kind !== 'custom') ? <Card>{list.filter((r) => r.kind !== 'custom').map((r, i, all) => renderRow(r, i === all.length - 1))}</Card> : null}
                    </View>
                );
            })}
        </FormPage>
    );
}
