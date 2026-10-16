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
import { updateRider, removeRider, fetchRiderLedger, recordHandover, adjustRiderCash, apiError } from '../../api/owners/shopApi';
import { rupees, toPaise, ago, riderName, ledgerLine } from '../../utils/owners/riderRules';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { ListShimmer } from '../../components/owners/shimmer';

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
        <Sheet visible={visible} onClose={onClose} title={handover ? 'Cash received from rider' : 'Correct the cash'}>
            <Text style={{ color: muted, marginBottom: 10 }}>
                {handover ? `He owes ${rupees(balancePaise)}. Enter what he gave you now.` : 'Use this only to fix a mistake. A reason is needed and is kept in the history.'}
            </Text>
            {!handover ? (
                <Chips options={[['more', 'He owes more'], ['less', 'He owes less']]} value={dir} onChange={setDir} style={{ marginTop: 0, marginBottom: 6 }} />
            ) : null}
            <Field value={amount} onChangeText={(x) => setAmount(x.replace(/[^\d.]/g, '').slice(0, 9))} placeholder="Amount in ₹" keyboardType="decimal-pad" maxLength={9} style={{ marginBottom: 10 }} />
            {tooMuch ? <Text style={{ color: '#C62828', marginBottom: 8 }}>He only owes {rupees(balancePaise)}.</Text> : null}
            <Field value={note} onChangeText={setNote} placeholder={handover ? 'Note (optional)' : 'Reason (required)'} maxLength={200} style={{ marginBottom: 14 }} />
            <Button
                label={handover ? 'Save cash received' : 'Save correction'}
                icon="checkmark"
                disabled={!valid}
                busy={busy}
                onPress={() => onSubmit({ amountPaise: handover ? paise : (dir === 'less' ? -paise : paise), note: note.trim() || undefined })}
            />
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

    useFocusEffect(useCallback(() => { useRidersStore.getState().load({ quiet: true }); loadLedger(1); }, [loadLedger]));

    if (!rider) {
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <PageHeader title="Rider" />
                {loaded ? <Empty icon="person-outline" title="Rider not found" hint="He may have been removed." /> : <ListShimmer />}
            </View>
        );
    }

    const submit = async (body) => {
        setSaving(true);
        try {
            if (sheet === 'handover') await recordHandover(userId, body); else await adjustRiderCash(userId, body);
            showToast('Saved');
            setSheet(null);
            useRidersStore.getState().load({ quiet: true });
            loadLedger(1);
        } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setSaving(false); }
    };

    const setActive = async (on) => {
        try { await updateRider(userId, { isActive: on }); showToast(on ? 'Rider switched on' : 'Rider switched off'); useRidersStore.getState().load({ quiet: true }); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const remove = async () => {
        const yes = await ask({
            title: 'Remove this rider?',
            message: balance > 0 ? `He still owes ${rupees(balance)}. The cash history is kept, but he can no longer deliver.` : 'He can no longer deliver. His history is kept.',
            confirmText: 'Remove rider', destructive: true,
        });
        if (!yes) return;
        try { await removeRider(userId); showToast('Rider removed'); useRidersStore.getState().load({ quiet: true }); nav.goBack(); }
        catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); }
    };

    const seen = rider.lastLocation?.at;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={riderName(rider)} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 60 }}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Avatar rider={rider} size={56} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 18 }} numberOfLines={1}>{riderName(rider)}</Text>
                            <Text style={{ color: muted, marginTop: 2 }}>{rider.phone || ''}</Text>
                            <View style={{ flexDirection: 'row', marginTop: 6, flexWrap: 'wrap' }}>
                                {!rider.isActive ? <Pill label="Switched off" color={muted} /> : rider.isOnline ? <Pill label="Online" color={ok} icon="radio-button-on" /> : <Pill label="Offline" color={muted} />}
                                {rider.ratingCount ? <View style={{ marginLeft: 6 }}><Pill label={`★ ${Number(rider.ratingAvg).toFixed(1)} · ${rider.ratingCount}`} color="#D97706" /></View> : null}
                            </View>
                        </View>
                    </View>
                    {seen ? <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>Location last seen {ago(seen)}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <View style={{ flex: 1, marginRight: 6 }}><Button label="Call" icon="call" kind="ghost" onPress={() => callPhone(rider.phone)} /></View>
                        <View style={{ flex: 1, marginLeft: 6 }}><Button label="WhatsApp" icon="logo-whatsapp" kind="ghost" onPress={() => whatsApp(rider.phone)} /></View>
                    </View>
                </Card>

                {rider.activeOrders?.length ? (
                    <>
                        <SectionTitle title="Delivering now" />
                        <Card>
                            {rider.activeOrders.map((o, i) => (
                                <Row key={o.id} icon="receipt" title={`Order #${o.orderNo}`} subtitle={String(o.deliveryStatus || o.status).replace(/_/g, ' ')} last={i === rider.activeOrders.length - 1} onPress={() => nav.navigate('OwnerOrder', { id: String(o.id) })} />
                            ))}
                        </Card>
                    </>
                ) : null}

                <SectionTitle title="Cash" />
                <Card tone={balance > 0 ? error : undefined}>
                    <Text style={{ color: muted, fontWeight: '700', fontSize: 12 }}>{balance > 0 ? 'He owes the shop' : 'Nothing to collect'}</Text>
                    <Text style={{ color: balance > 0 ? error : text, fontSize: 30, fontWeight: '900', marginTop: 2 }}>{rupees(balance)}</Text>
                    <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>Collected {rupees(cash?.collectedPaise)} · Given to shop {rupees(cash?.handedPaise)}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 12 }}>
                        <View style={{ flex: 1, marginRight: 6 }}><Button label="Cash received" icon="cash" disabled={balance <= 0} onPress={() => setSheet('handover')} /></View>
                        <View style={{ flex: 1, marginLeft: 6 }}><Button label="Correction" icon="create" kind="ghost" onPress={() => setSheet('adjust')} /></View>
                    </View>
                </Card>

                <SectionTitle title="Cash history" />
                <Card>
                    {rows === null ? <ListShimmer count={2} rows /> : null}
                    {rows && !rows.length ? <Text style={{ color: muted }}>No cash entries yet. They appear when he delivers a cash-on-delivery order.</Text> : null}
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
                    {more ? <View style={{ marginTop: 8 }}><Button label="Show more" kind="ghost" onPress={() => loadLedger(page + 1)} /></View> : null}
                </Card>

                <SectionTitle title="Rider" />
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: text, fontWeight: '800' }}>Can deliver</Text>
                            <Text style={{ color: muted, fontSize: 12 }}>Switch off to stop new orders going to him</Text>
                        </View>
                        <Toggle value={rider.isActive} onValueChange={setActive} />
                    </View>
                </Card>
                <View style={{ paddingHorizontal: 16 }}>
                    <Button label="Remove this rider" icon="trash" kind="danger" onPress={remove} />
                </View>
            </ScrollView>
            <AmountSheet mode={sheet || 'handover'} visible={!!sheet} balancePaise={balance} busy={saving} onClose={() => setSheet(null)} onSubmit={submit} />
        </View>
    );
}
