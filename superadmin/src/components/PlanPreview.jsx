import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font, radius } from '../theme';
import { Card, Badge } from './ui';
import Icon from './Icon';
import { fetchPlanPreview } from '../api/shopsApi';

// How a shop looks on a plan: the owner's menu (on / locked and which plan unlocks it), what a customer sees while the order is on the way,
// the limits as numbers, and the plan line with its price and dates. The server builds it from the same catalog it gates with
// (GET .../plan/preview), so what you see here is what the shop app will do.
const rs = (paise) => `Rs ${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

function Line({ icon, color, children }) {
    const t = useTheme();
    return (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
            <Icon name={icon} size={15} color={color || t.muted} />
            <Text style={{ color: t.text, marginLeft: 6, fontSize: font.sm, flex: 1 }}>{children}</Text>
        </View>
    );
}

// shopId: preview for that shop (its own price, free days and extras); empty: the plain plan (the new-shop wizard)
export default function PlanPreview({ shopId, plan, freeDays, title }) {
    const t = useTheme();
    const [pv, setPv] = useState(null);
    const [err, setErr] = useState(null);

    useEffect(() => {
        if (!plan) { setPv(null); return undefined; }
        let on = true;
        setErr(null);
        fetchPlanPreview(shopId, plan, freeDays === '' || freeDays === undefined ? undefined : Number(freeDays))
            .then((r) => { if (on) setPv(r.preview || r); })
            .catch(() => { if (on) setErr('Could not load the preview'); });
        return () => { on = false; };
    }, [shopId, plan, freeDays]);

    if (err) return <Card><Text style={{ color: t.danger }}>{err}</Text></Card>;
    if (!pv) return <Card><Text style={{ color: t.muted }}>Loading preview…</Text></Card>;

    const menu = pv.ownerMenu.filter((r) => r.state !== 'hidden');
    return (
        <Card>
            <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700' }}>{title || `How the shop looks on ${pv.name}`}</Text>

            {/* the plan line the owner reads in the menu and on the Plan screen */}
            <View style={{ backgroundColor: t.primarySoft, borderRadius: radius.md, padding: spacing.md, marginTop: spacing.sm }}>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{pv.header.line}</Text>
                <Text style={{ color: t.muted, marginTop: 2, fontSize: font.sm }}>
                    {pv.plan === 'partner' ? `No monthly price. Rs ${pv.header.perOrderFee.minRs} to Rs ${pv.header.perOrderFee.maxRs} per completed order from a prepaid wallet.` : `${rs(pv.header.pricePaise)} + GST per month. ${pv.header.freeDays ? `${pv.header.freeDays} free days first.` : 'No free days.'}`}
                </Text>
            </View>

            <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700', marginTop: spacing.md }}>Limits</Text>
            <Line icon="rider">Riders: {pv.limits.riders ?? 'unlimited'}</Line>
            <Line icon="users">Kitchen and waiter logins: {pv.limits.staff === 0 ? 'none (owner only)' : pv.limits.staff ?? 'unlimited'}</Line>

            {/* what the customer sees while the order is on the way */}
            <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700', marginTop: spacing.md }}>Customer: order on the way</Text>
            <View style={{ borderWidth: 1, borderColor: t.border, borderRadius: radius.md, padding: spacing.md, marginTop: 4 }}>
                {pv.customer.tracking === 'live_map' ? (
                    <>
                        <View style={{ height: 70, borderRadius: radius.sm, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                            <Icon name="pin" size={26} color={t.primary} />
                            <Text style={{ color: t.muted, fontSize: font.xs }}>Rider moving on a live map</Text>
                        </View>
                        <Text style={{ color: t.text, marginTop: 6, fontSize: font.sm }}>Live map with arrival time, rider name, Call button</Text>
                    </>
                ) : (
                    <>
                        {['Order placed', 'Preparing', 'On the way', 'Delivered'].map((s, i) => (
                            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', marginTop: i ? 4 : 0 }}>
                                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: i < 3 ? t.primary : t.border }} />
                                <Text style={{ color: t.text, marginLeft: 8, fontSize: font.sm }}>{s}</Text>
                            </View>
                        ))}
                        <Text style={{ color: t.muted, marginTop: 6, fontSize: font.sm }}>Timeline only: no rider on a map. Rider name and Call button stay.</Text>
                    </>
                )}
            </View>
            <Line icon={pv.customer.loyalty ? 'ok' : 'lock'}>Customer points and rewards: {pv.customer.loyalty ? 'on' : 'off'}</Line>
            <Line icon={pv.customer.services ? 'ok' : 'lock'}>Services and inquiries: {pv.customer.services ? 'on' : 'off'}</Line>
            <Line icon="ok">Dine-in QR tables, waitlist and table booking: on (every plan)</Line>

            {/* the owner's menu */}
            <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700', marginTop: spacing.md }}>Owner menu</Text>
            {menu.map((r) => (
                <View key={r.route} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <Icon name={r.state === 'on' ? 'ok' : 'lock'} size={15} color={r.state === 'on' ? t.success : t.muted} />
                    <Text style={{ color: r.state === 'on' ? t.text : t.muted, marginLeft: 6, fontSize: font.sm, flex: 1 }}>{r.title}</Text>
                    {r.state === 'locked' ? <Badge label={`Available in ${r.needs}`} tone="warn" /> : null}
                </View>
            ))}
            <Line icon="notes">Exports: {pv.other.exports}</Line>
            <Line icon={pv.other.soundboxVoice ? 'ok' : 'lock'}>Soundbox voice (app only): {pv.other.soundboxVoice ? 'on' : 'off'}</Line>
            <Line icon={pv.other.multiBranch ? 'ok' : 'lock'}>Multi-branch and custom domain: {pv.other.multiBranch ? 'on' : 'off'}</Line>

            {pv.changes.on.length || pv.changes.off.length ? (
                <View style={{ marginTop: spacing.md }}>
                    {pv.changes.on.length ? <Text style={{ color: t.success, fontSize: font.sm }}>Turns on: {pv.changes.on.join(', ')}.</Text> : null}
                    {pv.changes.off.length ? <Text style={{ color: t.danger, fontSize: font.sm, marginTop: 4 }}>Turns off: {pv.changes.off.join(', ')}.</Text> : null}
                </View>
            ) : null}
            {pv.extras.length ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>Kept as extras: {pv.extras.length}.</Text> : null}
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>Ends: {pv.header.endsAt ? day(pv.header.endsAt) : 'no end date'}. Built from the same plan list the server uses.</Text>
        </Card>
    );
}
