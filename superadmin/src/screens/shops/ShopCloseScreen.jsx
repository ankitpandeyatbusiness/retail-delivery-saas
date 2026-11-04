import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Chip, Badge, SectionTitle } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { fetchClosure, closeShop, reopenShop } from '../../api/shopsApi';
import { useShopStore } from '../../store/useShopStore';
import { useShopsStore } from '../../store/useShopsStore';
import { errMsg } from '../../api/adminClient';
import { rupees, dateOnly } from '../../utils/format';

// Close a shop (everything is kept, the shop just stops) or open it again.
// Closed for rent: the shop opens by itself the moment its rent is paid. Closed for another reason: only you open it.
const REASONS = [
    { label: 'Rent unpaid', kind: 'rent', text: 'Rent unpaid for months' },
    { label: 'Owner asked', kind: 'manual', text: 'The owner asked us to close it' },
    { label: 'Other reason', kind: 'manual', text: '' },
];

function Choice({ on, title, hint, onPress }) {
    const t = useTheme();
    return (
        <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected: on }} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'flex-start', padding: spacing.md, borderRadius: radius.md, borderWidth: 1.5, borderColor: on ? t.primary : t.border, backgroundColor: on ? t.primarySoft : t.surface, marginBottom: spacing.sm, opacity: pressed ? 0.9 : 1 })}>
            <View style={{ width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: on ? t.primary : t.muted, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md, marginTop: 2 }}>{on ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: t.primary }} /> : null}</View>
            <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontWeight: '800' }}>{title}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{hint}</Text>
            </View>
        </Pressable>
    );
}

export default function ShopCloseScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name, kind: kindParam, reason: reasonParam } = useRoute().params;
    const [p, setP] = useState(null);
    const [error, setError] = useState('');
    const [pick, setPick] = useState(kindParam === 'rent' ? 0 : 2);
    const [reason, setReason] = useState(reasonParam || '');
    const [orders, setOrders] = useState('finish');
    const [ask, setAsk] = useState(false);

    const load = useCallback(async () => {
        try { setP(await fetchClosure(shopId)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const after = async (msg) => {
        toast(msg);
        useShopStore.getState().load(shopId, { quiet: true });
        useShopsStore.getState().load({});
        await load();
    };
    const choose = (i) => { setPick(i); if (REASONS[i].text && (!reason || REASONS.some((r) => r.text === reason))) setReason(REASONS[i].text); if (!REASONS[i].text && REASONS.some((r) => r.text === reason)) setReason(''); };
    const doClose = async () => {
        try {
            const r = await closeShop(shopId, { reason: reason.trim(), kind: REASONS[pick].kind, orders });
            await after(r.closing ? 'No new orders. The shop closes when its orders are done.' : `${name} is closed${r.cancelled ? `. ${r.cancelled} order(s) cancelled and refunded` : ''}`);
        } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };
    const doOpen = async () => {
        try { await reopenShop(shopId, { confirmDue: true }); await after(`${name} is open again`); } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };

    if (!p) return <Screen title="Close shop" subtitle={name}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} />}</Screen>;
    const owes = p.owed.total > 0;
    const owedLine = `${rupees(p.owed.total)} unpaid in ${p.owed.bills} bill${p.owed.bills === 1 ? '' : 's'}${p.owed.oldestDueAt ? `, the oldest due ${dateOnly(p.owed.oldestDueAt)}` : ''}`;

    // ---------- the shop is closed (or closing) ----------
    if (p.closed) {
        const c = p.closure;
        return (
            <Screen title={p.closing ? 'Closing' : 'Closed shop'} subtitle={name}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                        <Badge label={p.closing ? 'Closing: waiting for orders' : 'Closed'} tone="danger" icon="lock" />
                        <Badge label={c.kind === 'rent' ? 'For rent' : 'Other reason'} tone={c.kind === 'rent' ? 'warn' : 'neutral'} />
                    </View>
                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, marginTop: spacing.md }}>{c.reason}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>Closed {dateOnly(c.at)}{c.by ? ` by ${c.by}` : ''}. Menu, orders, customers and bills are all kept.</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>
                        {c.kind === 'rent' ? 'It opens again by itself the moment all rent is paid.' : 'It stays closed until you open it.'}
                    </Text>
                </Card>
                <Card style={{ marginTop: spacing.md }}>
                    <Text style={{ color: t.text, fontWeight: '800' }}>Rent</Text>
                    <Text style={{ color: owes ? t.danger : t.success, fontWeight: '800', fontSize: font.lg, marginTop: 4 }}>{owes ? owedLine : 'Nothing is unpaid'}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>No new rent bills or late fees are added while the shop is closed.</Text>
                </Card>
                <Button style={{ marginTop: spacing.lg }} title="Open this shop again" icon="ok" onPress={() => setAsk(true)} />
                <ConfirmSheet
                    visible={ask}
                    onClose={() => setAsk(false)}
                    icon={owes ? 'warning' : 'ok'}
                    danger={owes}
                    title={owes ? 'Rent is still due' : 'Open this shop?'}
                    message={owes ? `${name} still owes ${owedLine}. Open it anyway? Customers can order again straight away.` : 'Customers, the owner and the staff can use the shop again.'}
                    confirmLabel={owes ? 'Open anyway' : 'Open shop'}
                    onConfirm={doOpen}
                />
            </Screen>
        );
    }

    // ---------- close it ----------
    const ready = reason.trim().length >= 3;
    return (
        <Screen title="Close shop" subtitle={name}>
            <Card>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>Nothing is deleted</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4, lineHeight: 19 }}>
                    Customers, the owner, the cook, the waiter and the riders see "closed". Menu, orders, customers and bills stay as they are. You can open the shop again any time.
                </Text>
                {owes ? <Text style={{ color: t.danger, fontWeight: '700', marginTop: spacing.md }}>This shop owes {owedLine}.</Text> : null}
            </Card>

            <SectionTitle section="alerts">Why are you closing it?</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {REASONS.map((r, i) => <Chip key={r.label} label={r.label} active={pick === i} onPress={() => choose(i)} />)}
            </View>
            <Field label="Reason (kept in your records, never shown to the owner or customers)" value={reason} onChangeText={setReason} maxLength={200} multiline placeholder="Write the reason" style={{ marginTop: spacing.md }} />
            {REASONS[pick].kind === 'rent' ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: -spacing.sm, marginBottom: spacing.md }}>Closed for rent: it opens again by itself when all rent is paid.</Text> : null}

            {p.activeOrders > 0 ? (
                <>
                    <SectionTitle section="orders">{p.activeOrders} order{p.activeOrders === 1 ? ' is' : 's are'} in progress</SectionTitle>
                    <Choice on={orders === 'finish'} title="Let them finish first (recommended)" hint="New orders stop now. The shop closes by itself when the last order is done." onPress={() => setOrders('finish')} />
                    <Choice on={orders === 'cancel'} title="Cancel them now and refund" hint="Every order in progress is cancelled and paid orders are refunded." onPress={() => setOrders('cancel')} />
                </>
            ) : null}

            <Button style={{ marginTop: spacing.lg }} kind="danger" title="Close this shop" icon="lock" disabled={!ready} onPress={() => setAsk(true)} />
            <ConfirmSheet
                visible={ask}
                onClose={() => setAsk(false)}
                icon="lock"
                danger
                title={`Close ${name}?`}
                message={p.activeOrders > 0 ? (orders === 'cancel' ? `${p.activeOrders} order(s) in progress will be cancelled and refunded. Then the shop closes.` : 'New orders stop now. The shop closes when the orders in progress are done.') : 'The shop closes right now for customers, the owner and the staff.'}
                confirmLabel="Close shop"
                onConfirm={doClose}
            />
        </Screen>
    );
}
