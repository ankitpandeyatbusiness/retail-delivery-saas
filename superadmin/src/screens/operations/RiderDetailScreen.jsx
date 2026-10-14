import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Linking } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, Avatar, SectionTitle, KeyValue, Stat, ListRow } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import PersonPhoto from '../../components/PersonPhoto';
import { Field } from '../../components/inputs';
import { NumberField, Choice } from '../../components/settingsForm';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { listRiders, codBalances, codLedger, codHandover, codAdjust, updateRider, removeRider } from '../../api/opsApi';
import { errMsg } from '../../api/adminClient';
import { rupees, dateTime, ago, titleCase } from '../../utils/format';

const TYPE_NAME = { collect: 'Cash collected', handover: 'Handed to the shop', adjust: 'Adjustment' };

// One rider: profile, the cash he holds, the cash history, and the actions that settle it.
export default function RiderDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name: shopName, userId } = useRoute().params;
    const [rider, setRider] = useState(null);
    const [bal, setBal] = useState(null);
    const [ledger, setLedger] = useState([]);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [error, setError] = useState('');
    const [sheet, setSheet] = useState(null);       // handover | adjust | rename | remove
    const [amount, setAmount] = useState(undefined);
    const [sign, setSign] = useState('plus');
    const [note, setNote] = useState('');
    const [newName, setNewName] = useState('');
    const [newEmail, setNewEmail] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const [r, c, l] = await Promise.all([listRiders(shopId), codBalances(shopId), codLedger(shopId, userId, { page: 1, limit: 20 })]);
            const me = r.items.find((x) => String(x.userId) === String(userId));
            if (!me) { setError('This rider was not found.'); return; }
            setRider(me);
            setBal((c.items || c).find((x) => String(x.riderId) === String(userId)) || { balancePaise: 0, collectedPaise: 0, handedPaise: 0, adjustedPaise: 0 });
            setLedger(l.items); setMore(l.hasMore); setPage(1); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [shopId, userId]);
    useEffect(() => { load(); }, [load]);

    const loadMore = async () => {
        try { const l = await codLedger(shopId, userId, { page: page + 1, limit: 20 }); setLedger((c) => [...c, ...l.items]); setMore(l.hasMore); setPage(page + 1); } catch (e) { toast(errMsg(e), 'error'); }
    };

    if (!rider) return <Screen title="Rider" subtitle={shopName}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} />}</Screen>;

    const owed = bal?.balancePaise || 0;
    const loc = rider.lastLocation;
    const submitCash = async (kind) => {
        if (!(amount > 0)) { toast('Enter an amount', 'error'); return; }
        const paise = Math.round(amount * 100);
        setBusy(true);
        try {
            if (kind === 'handover') await codHandover(shopId, userId, { amountPaise: paise, note: note.trim() || undefined });
            else await codAdjust(shopId, userId, { amountPaise: sign === 'minus' ? -paise : paise, note: note.trim() });
            toast(kind === 'handover' ? 'Cash received' : 'Adjustment saved');
            setSheet(null); setAmount(undefined); setNote(''); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title={rider.name || 'Rider'} subtitle={shopName} refreshing={false} onRefresh={load}>
            <Hero
                section="riders"
                leading={<PersonPhoto uri={rider.photo} name={rider.name || rider.phone} size={58} />}
                title={rider.name || 'No name'}
                subtitle={rider.phone}
            >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <Badge label={rider.isActive ? (rider.isOnline ? 'Online' : 'Offline') : 'Switched off'} tone={rider.isActive ? (rider.isOnline ? 'success' : 'neutral') : 'danger'} />
                    <Badge label={`${rider.activeOrderCount} active order${rider.activeOrderCount === 1 ? '' : 's'}`} tone="info" />
                    {rider.ratingCount ? <Badge label={`★ ${Number(rider.ratingAvg).toFixed(1)} (${rider.ratingCount})`} tone="success" /> : null}
                    {rider.vehicle?.type ? <Badge label={`${rider.vehicle.type}${rider.vehicle.number ? ` · ${rider.vehicle.number}` : ''}`} /> : null}
                </View>
                {loc?.at ? (
                    <Button
                        title={`Last seen ${ago(loc.at)} · open map`}
                        icon="pin"
                        kind="soft"
                        small
                        style={{ marginTop: spacing.lg }}
                        onPress={() => Linking.openURL(`geo:${loc.lat},${loc.lng}?q=${loc.lat},${loc.lng}`).catch(() => toast('No map app found', 'error'))}
                    />
                ) : null}
            </Hero>

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <Stat section={owed > 0 ? 'alerts' : 'money'} label="Cash with the rider" value={rupees(owed / 100)} icon="wallet" />
            </View>
            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.md }}>
                <Button style={{ flex: 1 }} icon="ok" title="Cash received" disabled={owed <= 0} onPress={() => { setAmount(owed / 100); setNote(''); setSheet('handover'); }} />
                <Button style={{ flex: 1 }} icon="tune" kind="outline" title="Adjust" onPress={() => { setAmount(undefined); setNote(''); setSign('plus'); setSheet('adjust'); }} />
            </View>

            <SectionTitle section="money">Cash history</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Collected from customers" value={rupees((bal?.collectedPaise || 0) / 100)} />
                <KeyValue label="Handed to the shop" value={rupees((bal?.handedPaise || 0) / 100)} />
                <KeyValue label="Adjustments" value={rupees((bal?.adjustedPaise || 0) / 100)} last />
            </Card>
            <Card padded={false} style={{ marginTop: spacing.md, paddingHorizontal: spacing.lg }}>
                {ledger.length ? ledger.map((e, i) => (
                    <View key={String(e.id)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                        <View style={{ flex: 1 }}>
                            <Text style={{ color: t.text, fontWeight: '700' }}>{TYPE_NAME[e.type] || titleCase(e.type)}{e.orderNo ? ` · #${e.orderNo}` : ''}</Text>
                            <Text style={{ color: t.muted, fontSize: font.xs }}>{dateTime(e.createdAt)}{e.note ? ` · ${e.note}` : ''}</Text>
                        </View>
                        <Text style={{ color: e.amountPaise < 0 ? t.success : t.text, fontWeight: '800' }}>{e.amountPaise < 0 ? '− ' : '+ '}{rupees(Math.abs(e.amountPaise) / 100)}</Text>
                    </View>
                )) : <Text style={{ color: t.muted, paddingVertical: spacing.lg }}>No cash entries yet.</Text>}
                {more ? <Button title="Show older" kind="soft" small style={{ marginVertical: spacing.md }} onPress={loadMore} /> : null}
            </Card>

            <SectionTitle section="settings">Manage</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="settings" icon="edit" title="Name and email" subtitle={[rider.name, rider.email].filter(Boolean).join(' · ') || 'Not set yet'} onPress={() => { setNewName(rider.name || ''); setNewEmail(rider.email || ''); setSheet('rename'); }} />
                <ListRow
                    section={rider.isActive ? 'catalog' : 'money'}
                    icon={rider.isActive ? 'block' : 'ok'}
                    title={rider.isActive ? 'Switch off' : 'Switch on'}
                    subtitle={rider.isActive ? 'Stops new deliveries for this rider' : 'The rider can deliver again'}
                    onPress={async () => { try { await updateRider(shopId, userId, { isActive: !rider.isActive }); toast(rider.isActive ? 'Switched off' : 'Switched on'); await load(); } catch (e) { toast(errMsg(e), 'error'); } }}
                />
                <ListRow danger section="alerts" icon="trash" title="Remove this rider" subtitle="They become a normal customer" onPress={() => setSheet('remove')} last />
            </Card>

            <Sheet visible={sheet === 'handover'} onClose={() => setSheet(null)} title="Cash received from the rider">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>The rider holds {rupees(owed / 100)}. Enter what was handed over.</Text>
                <NumberField label="Amount" prefix="₹" value={amount} onChange={setAmount} />
                <Field label="Note (optional)" value={note} onChangeText={setNote} maxLength={200} />
                <Button title="Record handover" loading={busy} onPress={() => submitCash('handover')} />
            </Sheet>

            <Sheet visible={sheet === 'adjust'} onClose={() => setSheet(null)} title="Adjust the cash balance">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>Use this to fix a mistake. A reason is needed and is kept in the log.</Text>
                <Choice options={[{ value: 'plus', label: 'Rider holds more' }, { value: 'minus', label: 'Rider holds less' }]} value={sign} onChange={setSign} />
                <NumberField label="Amount" prefix="₹" value={amount} onChange={setAmount} />
                <Field label="Reason" value={note} onChangeText={setNote} maxLength={200} />
                <Button title="Save adjustment" loading={busy} disabled={note.trim().length < 3} onPress={() => submitCash('adjust')} />
            </Sheet>

            <Sheet visible={sheet === 'rename'} onClose={() => setSheet(null)} title="Rider details">
                <Field label="Name" value={newName} onChangeText={setNewName} maxLength={80} />
                <Field label="Email (optional)" value={newEmail} onChangeText={setNewEmail} autoCapitalize="none" keyboardType="email-address" />
                <Button title="Save" loading={busy} onPress={async () => {
                    setBusy(true);
                    try { await updateRider(shopId, userId, { name: newName.trim(), email: newEmail.trim() }); toast('Saved'); setSheet(null); await load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
                }} />
            </Sheet>

            <ConfirmSheet
                visible={sheet === 'remove'}
                onClose={() => setSheet(null)}
                title="Remove this rider?"
                message="They are logged out and become a normal customer. Not possible while they have an order in progress."
                confirmLabel="Remove rider"
                danger
                onConfirm={async () => { try { await removeRider(shopId, userId); toast('Rider removed'); nav.goBack(); } catch (e) { toast(errMsg(e), 'error'); throw e; } }}
            />
        </Screen>
    );
}
