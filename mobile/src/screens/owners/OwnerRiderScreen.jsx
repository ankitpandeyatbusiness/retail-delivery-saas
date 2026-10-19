// One rider: contact, orders he is delivering, the cash he owes (with handover and corrections), the cash history,
// and switching him off / removing him. Opened with params { userId }.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Pill, Button, Row, Sheet, Field, Chips, SectionTitle, Empty } from '../../components/owners/ui';
import { Toggle } from '../../components/owners/menuBits';
import { callPhone, whatsApp } from '../../components/owners/orderBits';
import { Avatar } from './OwnerRidersScreen';
import { useRidersStore } from '../../store/owners/useRidersStore';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { updateRider, removeRider, fetchRiderLedger, recordHandover, adjustRiderCash, fetchRiderPay, saveRiderPay, recordRiderPayment, voidRiderPayment, apiError } from '../../api/owners/shopApi';
import PayPlanForm, { planProblem } from '../../components/owners/PayPlanForm';
import { Stat } from '../../components/owners/ui';
import { rupees, toPaise, ago, riderName, ledgerLine } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ListShimmer } from '../../components/owners/shimmer';
import { LeavePanel } from '../../components/owners/RiderLeave';
import RiderPointsCard from '../../components/owners/RiderPointsCard';
import { tr } from '../../i18n';

function AmountSheet({ mode, visible, balancePaise, onClose, onSubmit, busy }) {
    const { muted } = useBrand();
    const handover = mode === 'handover';
    const [amount, setAmount] = useState('');
    const [note, setNote] = useState('');
    const [dir, setDir] = useState('more');   // correction: rider owes more / less
    useEffect(() => { if (visible) { setAmount(handover && balancePaise > 0 ? String(balancePaise / 100) : ''); setNote(''); setDir('more'); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const paise = toPaise(amount);
    const tooMuch = handover && paise && paise > balancePaise;
    const needNote = !handover && note.trim().length < 3;
    const valid = !!paise && !tooMuch && !needNote;
    return (
        <Sheet visible={visible} onClose={onClose} title={handover ? tr('Cash received from rider') : tr('Correct the cash')}>
            <Text style={{ color: muted, marginBottom: 10 }}>
                {handover ? tr('He owes {rupees}. Enter what he gave you now.', { rupees: rupees(balancePaise) }) : tr('Use this only to fix a mistake. A reason is needed and is kept in the history.')}
            </Text>
            {!handover ? (
                <Chips options={[['more', tr('He owes more')], ['less', tr('He owes less')]]} value={dir} onChange={setDir} style={{ marginTop: 0, marginBottom: 6 }} />
            ) : null}
            <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 9))} placeholder={tr('Amount in ₹')} keyboardType="decimal-pad" maxLength={9} style={{ marginBottom: 10 }} />
            {tooMuch ? <Text style={{ color: '#C62828', marginBottom: 8 }}>{tr('He only owes {rupees}.', { rupees: rupees(balancePaise) })}</Text> : null}
            <Field value={note} onChangeText={setNote} placeholder={handover ? tr('Note (optional)') : tr('Reason (required)')} maxLength={200} style={{ marginBottom: 14 }} />
            <Button
                label={handover ? tr('Save cash received') : tr('Save correction')}
                icon="checkmark"
                disabled={!valid}
                busy={busy}
                onPress={() => onSubmit({ amountPaise: handover ? paise : (dir === 'less' ? -paise : paise), note: note.trim() || undefined })}
            />
        </Sheet>
    );
}

// writing down a payment the owner made to the rider (the money moves outside the app)
function PaymentSheet({ visible, plan, onClose, onSubmit, busy }) {
    const { muted } = useBrand();
    const [amount, setAmount] = useState('');
    const [kind, setKind] = useState('earnings');
    const [note, setNote] = useState('');
    useEffect(() => { if (visible) { setAmount(''); setNote(''); setKind(plan?.type === 'salary' ? 'salary' : 'earnings'); } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const paise = toPaise(amount);
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Record a payment')}>
            <Text style={{ color: muted, marginBottom: 10 }}>{tr('Write down money you gave the rider. He will see it in his app.')}</Text>
            <Chips options={[['earnings', tr('For deliveries')], ['salary', tr('Salary')], ['advance', tr('Advance')], ['bonus', tr('Bonus')]]} value={kind} onChange={setKind} style={{ marginTop: 0, marginBottom: 8 }} />
            <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 9))} placeholder={tr('Amount in ₹')} keyboardType="decimal-pad" maxLength={9} style={{ marginBottom: 10 }} />
            <Field value={note} onChangeText={setNote} placeholder={tr('Note (optional)')} maxLength={200} style={{ marginBottom: 14 }} />
            <Button label={tr('Save payment')} icon="checkmark" disabled={!paise || paise < 100} busy={busy} onPress={() => onSubmit({ amountPaise: paise, kind, note: note.trim() || undefined })} />
        </Sheet>
    );
}

export default function OwnerRiderScreen() {
    const nav = useNavigation();
    const { userId } = useRoute().params || {};
    const { background, text, muted, error, ok, primary } = useBrand();
    const rider = useRidersStore((s) => s.riders.find((r) => String(r.userId) === String(userId)));
    const cash = useRidersStore((s) => s.cash[String(userId)]);
    const loaded = useRidersStore((s) => s.loadedAt);
    const [sheet, setSheet] = useState(null);       // 'handover' | 'adjust'
    const [payInfo, setPayInfo] = useState(null);
    const [planSheet, setPlanSheet] = useState(false);
    const [plan, setPlan] = useState({ type: 'same' });
    const [paySheet, setPaySheet] = useState(false);
    const [saving, setSaving] = useState(false);
    const [rows, setRows] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);

    const balance = cash?.balancePaise || 0;

    const loadLedger = useCallback(async (p = 1) => {
        try {
            const r = await fetchRiderLedger(userId, { page: p, limit: 20 });
            setRows((old) => (p === 1 ? r.items : [...(old || []), ...r.items]));
            setMore(!!r.hasMore);
            setPage(p);
        } catch (e) { useOwnerStore.getState().noteError(e); setRows((x) => x || []); }
    }, [userId]);

    const loadPay = useCallback(async () => {
        try { setPayInfo(await fetchRiderPay(userId)); } catch (e) { useOwnerStore.getState().noteError(e); }
    }, [userId]);
    useFocusEffect(useCallback(() => { useRidersStore.getState().load({ quiet: true }); loadLedger(1); loadPay(); }, [loadLedger, loadPay]));

    if (!rider) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title={tr('Rider')} />
                {loaded ? <Empty icon="person-outline" title={tr('Rider not found')} hint={tr('He may have been removed.')} /> : <ListShimmer />}
            </View>
        );
    }

    const submit = async (body) => {
        setSaving(true);
        try {
            if (sheet === 'handover') await recordHandover(userId, body); else await adjustRiderCash(userId, body);
            showToast(tr('Saved'));
            setSheet(null);
            useRidersStore.getState().load({ quiet: true });
            loadLedger(1);
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const openPlan = () => { setPlan(payInfo?.own || { type: 'same' }); setPlanSheet(true); };
    const savePlan = async () => {
        if (planProblem(plan)) { showToast(planProblem(plan)); return; }
        setSaving(true);
        try { await saveRiderPay(userId, plan.type === 'same' ? null : plan); showToast(tr('Saved')); setPlanSheet(false); useRidersStore.getState().load({ quiet: true }); loadPay(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };
    const savePayment = async (body) => {
        setSaving(true);
        try { await recordRiderPayment(userId, body); showToast(tr('Payment saved')); setPaySheet(false); loadPay(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };
    const cancelPayment = async (p) => {
        if (!(await ask({ title: tr('Cancel this payment?'), message: tr('It stops counting. The history keeps it as cancelled.'), confirmText: tr('Cancel payment'), destructive: true }))) return;
        try { await voidRiderPayment(userId, p.id, 'Entered by mistake'); showToast(tr('Cancelled')); loadPay(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const setActive = async (on) => {
        try { await updateRider(userId, { isActive: on }); showToast(on ? tr('Rider switched on') : tr('Rider switched off')); useRidersStore.getState().load({ quiet: true }); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const remove = async () => {
        const yes = await ask({
            title: tr('Remove this rider?'),
            message: balance > 0 ? tr('He still owes {rupees}. The cash history is kept, but he can no longer deliver.', { rupees: rupees(balance) }) : tr('He can no longer deliver. His history is kept.'),
            confirmText: tr('Remove rider'), destructive: true,
        });
        if (!yes) return;
        try { await removeRider(userId); showToast(tr('Rider removed')); useRidersStore.getState().load({ quiet: true }); nav.goBack(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const seen = rider.lastLocation?.at;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={riderName(rider)} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Avatar rider={rider} size={56} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 18 }} numberOfLines={1}>{riderName(rider)}</Text>
                            <Text style={{ color: muted, marginTop: 2 }}>{rider.phone || ''}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                {!rider.isActive ? <Pill label={tr('Switched off')} color={muted} /> : rider.isOnline ? <Pill label={tr('Online')} color={ok} icon="radio-button-on" /> : <Pill label={tr('Offline')} color={muted} />}
                                {rider.ratingCount ? <View style={{ marginLeft: 6 }}><Pill label={`★ ${Number(rider.ratingAvg).toFixed(1)} · ${rider.ratingCount}`} color="#D97706" /></View> : null}
                                {rider.avgDeliveryMin ? <View style={{ marginLeft: 6 }}><Pill label={tr('Avg {min} min', { min: rider.avgDeliveryMin })} color={muted} icon="time-outline" /></View> : null}
                                {rider.lateCount > 0 ? <View style={{ marginLeft: 6 }}><Pill label={tr('{n} late of {total}', { n: rider.lateCount, total: rider.deliveryCount })} color={muted} /></View> : null}
                            </View>
                        </View>
                    </View>
                    {seen ? <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{tr('Location last seen {ago}', { ago: ago(seen) })}</Text> : null}
                    {rider.faultCount > 0 ? <Text style={{ color: error, fontSize: 12, fontWeight: '700', marginTop: 6 }}>{tr('Marked at fault in {faultCount} complaint{v2}', { faultCount: rider.faultCount, v2: rider.faultCount === 1 ? '' : 's' })}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <View style={{ flex: 1, marginRight: 6 }}><Button label={tr('Call')} icon="call" iconOnly kind="ghost" onPress={() => callPhone(rider.phone)} /></View>
                        <View style={{ flex: 1, marginLeft: 6 }}><Button label={tr('WhatsApp')} icon="logo-whatsapp" iconOnly kind="ghost" onPress={() => whatsApp(rider.phone)} /></View>
                    </View>
                </Card>

                {rider.activeOrders?.length ? (
                    <>
                        <SectionTitle title={tr('Delivering now')} />
                        <Card>
                            {rider.activeOrders.map((o, i) => (
                                <Row key={o.id} icon="receipt" title={tr('Order #{orderNo}', { orderNo: o.orderNo })} subtitle={String(o.deliveryStatus || o.status).replace(/_/g, ' ')} last={i === rider.activeOrders.length - 1} onPress={() => nav.navigate('OwnerOrder', { id: String(o.id) })} />
                            ))}
                        </Card>
                    </>
                ) : null}

                <SectionTitle title={tr('Pay')} />
                <Card>
                    <Row icon="wallet" title={tr('How he is paid')} subtitle={`${payInfo?.label || rider.payLabel || ''}${(payInfo?.own || rider.ownPay) ? '  ·  his own plan' : ''}`} onPress={openPlan} last={!payInfo || payInfo.money?.hidden} />
                    {payInfo && !payInfo.money?.hidden && payInfo.money?.earned ? (
                        <View style={{ flexDirection: 'row', marginTop: 8 }}>
                            <Stat label={tr('Today')} value={rupees(payInfo.money.earned.todayPaise)} />
                            <Stat label={tr('This week')} value={rupees(payInfo.money.earned.weekPaise)} />
                            <Stat label={tr('This month')} value={rupees(payInfo.money.earned.monthPaise)} />
                        </View>
                    ) : null}
                    {payInfo?.trackPayouts && !payInfo.money?.hidden ? (
                        <>
                            {payInfo.money.pendingPaise != null ? (
                                <View style={{ flexDirection: 'row', marginTop: 8 }}>
                                    <Stat label={tr('You paid')} value={rupees(payInfo.money.paidPaise)} color={ok} />
                                    <Stat label={tr('Still to pay')} value={rupees(payInfo.money.pendingPaise)} color={payInfo.money.pendingPaise > 0 ? error : text} />
                                </View>
                            ) : null}
                            <View style={{ marginTop: 12 }}><Button label={tr('Record a payment')} icon="add" onPress={() => setPaySheet(true)} /></View>
                            {payInfo.money.payments.map((p) => (
                                <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: 0.5, borderTopColor: muted + '55', opacity: p.voided ? 0.5 : 1 }}>
                                    <View style={{ flex: 1 }}>
                                        <Text style={{ color: text, fontWeight: '700' }}>{({ earnings: 'Delivery pay', advance: 'Advance', salary: 'Salary', bonus: 'Bonus' })[p.kind] || p.kind}{p.voided ? tr(' (cancelled)') : ''}</Text>
                                        <Text style={{ color: muted, fontSize: 12 }}>{ago(p.paidAt)}{p.note ? `  ·  ${p.note}` : ''}</Text>
                                    </View>
                                    <Text style={{ color: text, fontWeight: '900' }}>{rupees(p.amountPaise)}</Text>
                                    {!p.voided ? <Pressable onPress={() => cancelPayment(p)} hitSlop={8} style={{ marginLeft: 10 }}><Ionicons name="close-circle-outline" size={20} color={muted} /></Pressable> : null}
                                </View>
                            ))}
                        </>
                    ) : null}
                </Card>

                <RiderPointsCard userId={userId} />

                <LeavePanel riderId={userId} monthDays={rider.leave?.monthDays || 0} />

                <SectionTitle title={tr('Cash')} />
                <Card tone={balance > 0 ? error : undefined}>
                    <Text style={{ color: muted, fontWeight: '700', fontSize: 12 }}>{balance > 0 ? tr('He owes the shop') : tr('Nothing to collect')}</Text>
                    <Text style={{ color: balance > 0 ? error : text, fontSize: 30, fontWeight: '900', marginTop: 2 }}>{rupees(balance)}</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>{tr('Collected {rupees} · Given to shop {rupees2}', { rupees: rupees(cash?.collectedPaise), rupees2: rupees(cash?.handedPaise) })}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <View style={{ flex: 1, marginRight: 6 }}><Button label={tr('Cash received')} icon="cash" iconOnly disabled={balance <= 0} onPress={() => setSheet('handover')} /></View>
                        <View style={{ flex: 1, marginLeft: 6 }}><Button label={tr('Correction')} icon="create" iconOnly kind="ghost" onPress={() => setSheet('adjust')} /></View>
                    </View>
                </Card>

                <SectionTitle title={tr('Cash history')} />
                <Card>
                    {rows === null ? <ListShimmer count={2} rows /> : null}
                    {rows && !rows.length ? <Text style={{ color: muted }}>{tr('No cash entries yet. They appear when he delivers a cash-on-delivery order.')}</Text> : null}
                    {(rows || []).map((r, i) => {
                        const [title, sign] = ledgerLine(r);
                        return (
                            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderTopWidth: i ? 0.5 : 0, borderTopColor: muted + '55' }}>
                                <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text style={{ color: text, fontWeight: '700' }} numberOfLines={2}>{title}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>{ago(r.createdAt)}{r.note ? `  ·  ${r.note}` : ''}</Text>
                                </View>
                                <Text style={{ color: sign > 0 ? error : ok, fontWeight: '900' }}>{sign > 0 ? '+' : '−'}{rupees(Math.abs(r.amountPaise))}</Text>
                            </View>
                        );
                    })}
                    {more ? <View style={{ marginTop: 8 }}><Button label={tr('Show more')} kind="ghost" onPress={() => loadLedger(page + 1)} /></View> : null}
                </Card>

                <SectionTitle title={tr('Rider')} />
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '800' }}>{tr('Can deliver')}</Text>
                            <Text style={{ color: muted, fontSize: 12 }}>{tr('Switch off to stop new orders going to him')}</Text>
                        </View>
                        <Toggle value={rider.isActive} onValueChange={setActive} />
                    </View>
                </Card>
                <View style={{ paddingHorizontal: 16 }}>
                    <Button label={tr('Remove this rider')} icon="trash" kind="danger" onPress={remove} />
                </View>
            </ScrollView>
            <Sheet visible={planSheet} onClose={() => setPlanSheet(false)} title={tr('How is he paid?')}>
                <PayPlanForm value={plan} onChange={setPlan} allowSame sameText={tr('Follows the plan in Delivery rules')} />
                <View style={{ marginTop: 14 }}><Button label={tr('Save')} icon="checkmark" busy={saving} onPress={savePlan} /></View>
            </Sheet>
            <PaymentSheet visible={paySheet} plan={payInfo?.own || payInfo?.shop} busy={saving} onClose={() => setPaySheet(false)} onSubmit={savePayment} />
            <AmountSheet mode={sheet || 'handover'} visible={!!sheet} balancePaise={balance} busy={saving} onClose={() => setSheet(null)} onSubmit={submit} />
        </View>
    );
}
