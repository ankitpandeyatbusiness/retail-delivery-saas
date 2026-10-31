// Automations: everything the shop does by itself, in one place. Each row is a switch or a choice and saves the moment it changes.
// What is switched on is done by the system once the time you chose has passed (and you are told afterwards); what is off, you do by hand.
// The settings live where they always did (auto accept, dine in, delivery rules, booking) and in the shop's automation row (services/automations.js).
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { Button } from '../../components/owners/ui';
import { FormPage, Group, ToggleRow, ChoiceBox } from '../../components/owners/menuBits';
import { AutoAcceptCard } from '../../components/owners/AutoAccept';
import { FormShimmer } from '../../components/owners/shimmer';
import { fetchSettings, saveSettings, booking as bookingApi, automations as autoApi, apiError } from '../../api/owners/shopApi';
import { useMenuFlags } from '../../utils/owners/menuFlags';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ease } from '../../utils/common/ease';
import { tr } from '../../i18n';

const mins = (n) => (n >= 60 && n % 60 === 0 ? (n === 60 ? tr('1 hour') : tr('{n} hours', { n: n / 60 })) : tr('{n} minutes', { n }));
const opts = (list) => list.map((n) => (n === 0 ? [0, tr('Off')] : [n, mins(n)]));
const days = () => [[0, tr('Off')], [3, tr('{n} days', { n: 3 })], [7, tr('{n} days', { n: 7 })], [14, tr('{n} days', { n: 14 })]];
const hoursOf = (cur) => [3, 6, 12, 24].concat([3, 6, 12, 24].includes(cur) || !cur ? [] : [cur]).sort((x, y) => x - y).map((h) => [h, h === 1 ? tr('1 hour') : tr('{n} hours', { n: h })]);
// the current value stays in the list even when it is not one of the usual choices
const withValue = (list, v) => (v === undefined || v === null || list.some((x) => x[0] === v) ? list : [...list, [v, mins(v)]].sort((a, b) => a[0] - b[0]));

export default function OwnerAutomationsScreen() {
    const nav = useNavigation();
    const { muted, text } = useBrand();
    const bookingOn = useMenuFlags((s) => s.bookingOn);
    const servicesOn = useMenuFlags((s) => s.servicesOn);
    const [a, setA] = useState(null);          // the shop's own automations (new ones)
    const [dine, setDine] = useState(null);    // settings.orders.dineIn
    const [rid, setRid] = useState(null);      // settings.riders
    const [bk, setBk] = useState(null);        // booking settings
    const [err, setErr] = useState('');

    const load = useCallback(async () => {
        try {
            const [auto, st, b] = await Promise.all([autoApi.get(), fetchSettings(), bookingOn ? bookingApi.settings().catch(() => null) : null]);
            setA(auto); setDine(st.orders?.dineIn || {}); setRid(st.riders || {}); setBk(b);
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not open Automations.')); }
    }, [bookingOn]);
    useEffect(() => { load(); }, [load]);

    // each change shows at once and is saved; if it cannot be saved it goes back
    const saveA = async (patch) => { const before = a; ease(); setA({ ...a, ...patch }); try { setA(await autoApi.save(patch)); } catch (e) { setA(before); showToast(apiError(e)); } };
    const saveDine = async (patch) => { const before = dine; ease(); setDine({ ...dine, ...patch }); try { await saveSettings({ orders: { dineIn: patch } }); } catch (e) { setDine(before); showToast(apiError(e)); } };
    const saveRid = async (patch) => { const before = rid; ease(); setRid({ ...rid, ...patch }); try { await saveSettings({ riders: patch }); } catch (e) { setRid(before); showToast(apiError(e)); } };
    const saveBk = async (patch) => { const before = bk; ease(); setBk({ ...bk, ...patch }); try { await bookingApi.saveSettings(patch); } catch (e) { setBk(before); showToast(apiError(e)); } };

    const everything = async (hand) => {
        const yes = await ask({ title: hand ? tr('Do everything by hand?') : tr('Use the recommended automations?'), message: hand ? tr('Every automation below goes off. Nothing is done for you, and you will not get automatic reminders.') : tr('The automations in the screen go back to what we recommend.'), confirmText: hand ? tr('Everything by hand') : tr('Use recommended') });
        if (!yes) return;
        try {
            if (hand) {
                setA(await autoApi.save({ reservationAutoAllowMin: 0, reservationNoShowMin: 0, depositAutoAdjust: false, pickupNotCollectedMin: 0, cancelRequestDeclineMin: 0, inquiryCloseDays: 0, stageAlerts: false, cashLimitReminders: false, leaveReminders: false, kitchenProblemReminders: false, complaintReminders: false, autoApproveLeave: false }));
                await saveSettings({ orders: { dineIn: { autoReady: false, autoServe: false, busyAuto: false, owedDaily: false } } });
            } else {
                setA(await autoApi.reset());
                await saveSettings({ orders: { dineIn: { autoReady: true, autoServe: true, busyAuto: true, owedDaily: true } } });
            }
            await load();
            showToast(hand ? tr('Everything is by hand now') : tr('Back to the recommended automations'));
        } catch (e) { showToast(apiError(e)); }
    };

    if (!a || !dine || !rid) return <FormPage title={tr('Automations')}>{err ? <Text style={{ color: muted, padding: 20 }}>{err}</Text> : <FormShimmer cards={4} />}</FormPage>;
    const dineOn = dine.enabled !== false;

    return (
        <FormPage title={tr('Automations')}>
            <Text style={{ color: muted, fontSize: 13, paddingHorizontal: 18, marginBottom: 6, lineHeight: 19 }}>{tr('What is switched on is done for you after the time you choose, and you are told afterwards. What is off, you do by hand. Whatever you do first always wins.')}</Text>
            <View style={{ flexDirection: 'row', paddingHorizontal: 16, marginBottom: 6 }}>
                <Button label={tr('Recommended')} icon="sparkles" kind="ghost" onPress={() => everything(false)} style={{ flex: 1, marginRight: 8 }} />
                <Button label={tr('All by hand')} icon="hand-left" kind="ghost" onPress={() => everything(true)} style={{ flex: 1 }} />
            </View>

            <Group title={tr('New orders')} hint={tr('An order nobody accepts in 10 minutes is cancelled by the system with a full refund. That is always on.')}>
                <AutoAcceptCard />
            </Group>

            <Group title={tr('Delivery')}>
                <ChoiceBox label={tr('How is a rider picked')} options={[['automatic', tr('Automatic')], ['manual', tr('I choose')]]} value={rid.assignMode || 'automatic'} onChange={(x) => saveRid({ assignMode: x })} last={rid.assignMode === 'manual'} />
                {rid.assignMode !== 'manual' ? <ChoiceBox label={tr('Time a rider has to answer')} options={[[60, tr('1 minute')], [90, tr('90 seconds')], [120, tr('2 minutes')], [180, tr('3 minutes')]].concat([60, 90, 120, 180].includes(rid.offerSeconds) || !rid.offerSeconds ? [] : [[rid.offerSeconds, tr('{n} seconds', { n: rid.offerSeconds })]])} value={rid.offerSeconds || 120} onChange={(x) => saveRid({ offerSeconds: x })} last /> : null}
            </Group>

            {dineOn ? (
                <Group title={tr('Kitchen and tables')} hint={tr('Less work for you. You can always press the buttons yourself.')}>
                    <ToggleRow title={tr('Mark dishes ready by themselves')} subtitle={dine.autoReady ? tr('Ready after the cooking time') : tr('Off: you press Ready each time')} value={!!dine.autoReady} onValueChange={(x) => saveDine({ autoReady: x })} last={!dine.autoReady} />
                    {dine.autoReady ? <ChoiceBox label={tr('Average cooking time')} options={withValue(opts([10, 15, 20, 30, 45]), dine.readyMin)} value={dine.readyMin ?? 15} onChange={(x) => saveDine({ readyMin: x })} last /> : null}
                    <ToggleRow title={tr('Mark dishes served by themselves')} subtitle={dine.autoServe ? tr('Served some minutes after ready') : tr('Off: you press Served each time')} value={!!dine.autoServe} onValueChange={(x) => saveDine({ autoServe: x })} last={!dine.autoServe} />
                    {dine.autoServe ? <ChoiceBox label={tr('Serve after')} options={withValue(opts([5, 10, 15]), dine.serveMin)} value={dine.serveMin ?? 10} onChange={(x) => saveDine({ serveMin: x })} last /> : null}
                    <ToggleRow title={tr('Tell customers when we are busy')} subtitle={dine.busyAuto ? tr('Automatic, when many tables are taken') : tr('Off')} value={!!dine.busyAuto} onValueChange={(x) => saveDine({ busyAuto: x })} />
                    <ChoiceBox label={tr('A table with nothing owed closes after')} options={hoursOf(dine.autoCloseHours)} value={dine.autoCloseHours || 6} onChange={(x) => saveDine({ autoCloseHours: x })} />
                    <ChoiceBox label={tr('A guest asks to cancel a dish being made')} options={opts([0, 3, 5, 10])} value={a.cancelRequestDeclineMin} onChange={(x) => saveA({ cancelRequestDeclineMin: x })} last />
                    <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('If it is already being made, the request is declined after this time. A dish not started yet is left to you.')}</Text>
                </Group>
            ) : null}

            {dineOn ? (
                <Group title={tr('Unpaid bills')} hint={tr('Guests who left without paying are reminded for you.')}>
                    <ToggleRow title={tr('Remind them every day')} subtitle={dine.owedDaily ? tr('Everyone who owes gets a reminder once a day') : tr('Off: you remind them yourself')} value={!!dine.owedDaily} onValueChange={(x) => saveDine({ owedDaily: x })} last={!dine.owedDaily} />
                    {dine.owedDaily ? <ChoiceBox label={tr('Remind at')} options={[[9, '9 AM'], [11, '11 AM'], [14, '2 PM'], [17, '5 PM'], [19, '7 PM']].concat([9, 11, 14, 17, 19].includes(dine.owedHour) || dine.owedHour === undefined ? [] : [[dine.owedHour, `${dine.owedHour}:00`]])} value={dine.owedHour ?? 11} onChange={(x) => saveDine({ owedHour: x })} /> : null}
                    {dine.owedDaily ? <ChoiceBox label={tr('Stop the daily reminders after')} options={[3, 5, 7, 10, 14].concat([3, 5, 7, 10, 14].includes(dine.owedMax) || dine.owedMax === undefined ? [] : [dine.owedMax]).map((n) => [n, tr('{n} reminders', { n })])} value={dine.owedMax ?? 5} onChange={(x) => saveDine({ owedMax: x })} last /> : null}
                </Group>
            ) : null}

            <Group title={tr('Pickup orders')}>
                <ChoiceBox label={tr('A ready order nobody collected is marked not collected')} options={[[0, tr('Off')], [30, tr('30 minutes after the pickup time ends')], [60, tr('1 hour after')], [120, tr('2 hours after')]]} value={a.pickupNotCollectedMin} onChange={(x) => saveA({ pickupNotCollectedMin: x })} last />
                <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>{tr('The customer is counted as at fault, like when you mark it yourself.')}</Text>
            </Group>

            {bookingOn && bk ? (
                <Group title={tr('Reservations')}>
                    <ToggleRow title={tr('Allow paid reservations at once')} subtitle={bk.autoAllow ? tr('Confirmed the moment the deposit is paid') : tr('Off: you tap Allow, or it is allowed after the time below')} value={!!bk.autoAllow} onValueChange={(x) => saveBk({ autoAllow: x })} last={!!bk.autoAllow} />
                    {!bk.autoAllow ? <ChoiceBox label={tr('A reservation you did not answer is allowed after')} options={opts([0, 15, 30, 60])} value={a.reservationAutoAllowMin} onChange={(x) => saveA({ reservationAutoAllowMin: x })} /> : null}
                    <ChoiceBox label={tr('A guest who did not come is marked no-show after')} options={opts([0, 15, 30, 45, 60])} value={a.reservationNoShowMin} onChange={(x) => saveA({ reservationNoShowMin: x })} />
                    <Text style={{ color: muted, fontSize: 12, marginBottom: 12 }}>{tr('Counted from the start time. A guest who is already eating at his table is marked seated instead, so his deposit is safe.')}</Text>
                    <ToggleRow title={tr('Mark the deposit taken off the bill')} subtitle={a.depositAutoAdjust ? tr('When the guest\'s table bill is closed') : tr('Off: you mark it yourself')} value={!!a.depositAutoAdjust} onValueChange={(x) => saveA({ depositAutoAdjust: x })} last />
                </Group>
            ) : null}

            <Group title={tr('Inquiries and complaints')}>
                {servicesOn ? <ChoiceBox label={tr('An answered inquiry with no new message is ended after')} options={days()} value={a.inquiryCloseDays} onChange={(x) => saveA({ inquiryCloseDays: x })} /> : null}
                <ToggleRow title={tr('Remind me about a complaint nobody answered')} subtitle={a.complaintReminders ? tr('Every day, up to 3 times') : tr('Off')} value={!!a.complaintReminders} onValueChange={(x) => saveA({ complaintReminders: x })} last />
            </Group>

            <Group title={tr('Reminders to you')} hint={tr('These only remind you. The decision stays with you.')}>
                <ToggleRow title={tr('An order stays too long in one stage')} subtitle={a.stageAlerts ? tr('Cooking over an hour, or ready with no rider') : tr('Off')} value={!!a.stageAlerts} onValueChange={(x) => saveA({ stageAlerts: x })} />
                <ToggleRow title={tr('The kitchen reported a problem')} subtitle={a.kitchenProblemReminders ? tr('Every 10 minutes until you answer') : tr('Off')} value={!!a.kitchenProblemReminders} onValueChange={(x) => saveA({ kitchenProblemReminders: x })} />
                <ToggleRow title={tr('A rider holds too much cash')} subtitle={a.cashLimitReminders ? tr('Every few hours until you record the handover') : tr('Off')} value={!!a.cashLimitReminders} onValueChange={(x) => saveA({ cashLimitReminders: x })} />
                <ToggleRow title={tr('A leave request nobody answered')} subtitle={a.leaveReminders ? tr('After 2 hours, and again later') : tr('Off')} value={!!a.leaveReminders} onValueChange={(x) => saveA({ leaveReminders: x })} last />
            </Group>

            <Group title={tr('Staff leave')} hint={tr('Off by default: approving leave is your decision.')}>
                <ToggleRow title={tr('Approve a staff leave request nobody answered')} subtitle={a.autoApproveLeave ? tr('Approved after 2 hours') : tr('Off: you decide')} value={!!a.autoApproveLeave} onValueChange={(x) => saveA({ autoApproveLeave: x })} last />
            </Group>

            <Group title={tr('Messages to customers')}>
                <Pressable onPress={() => nav.navigate('OwnerAutopilot')} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
                    <Ionicons name="rocket" size={22} color={text} />
                    <View style={{ flex: 1, marginHorizontal: 12 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 15 }}>{tr('Autopilot')}</Text>
                        <Text style={{ color: muted, fontSize: 12.5 }}>{tr('Welcome, win-back, meal-time and festival messages, and your daily summary')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={muted} />
                </Pressable>
            </Group>
        </FormPage>
    );
}
