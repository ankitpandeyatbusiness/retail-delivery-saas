import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, spacing, font } from '../../theme';
import { fetchPlanPreview } from '../../api/shopsApi';

// The OWNER app's menu as the shop owner will see it on this plan: the plan line on top, then every group, with the rows the plan does not include
// locked ("Available in Pro") and the Wallet row only on Partner. The plan-dependent rows come from the server (the same plan list it gates with);
// the other rows are the ones every plan has. Mirrors mobile/src/screens/owners/ShopHubScreen.jsx.
const GROUPS = [
    ['Run the shop', [['restaurant', 'Dine in'], ['bicycle', 'Riders'], ['flame', 'Kitchen staff', 'OwnerCooks'], ['restaurant', 'Waiters', 'OwnerWaiters']]],
    ['Customers and care', [['people', 'Customers'], ['star', 'Reviews'], ['megaphone', 'Messages'], ['rocket', 'Autopilot', 'OwnerAutopilot'], ['gift', 'Rewards and points', 'OwnerRewards']]],
    ['Menu and offers', [['list', 'Categories'], ['pricetag', 'Coupons'], ['calendar', 'Reservations'], ['chatbubbles', 'Inquiries', 'OwnerInquiries'], ['cube', 'Bulk orders', 'OwnerBulk'], ['briefcase', 'Services', 'OwnerServices']]],
    ['Money', [['ribbon', 'Plan', 'OwnerPlan'], ['card', 'Wallet', 'OwnerWallet'], ['wallet', 'Money'], ['calculator', 'Costs and profit', 'OwnerCosts'], ['trending-up', 'Business report', 'OwnerReportsHub'], ['download', 'Download your data']]],
];

const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

export default function OwnerMenuPreview({ plan, shopId, freeDays }) {
    const t = useTheme();
    const [pv, setPv] = useState(null);
    useEffect(() => {
        if (!plan) return undefined;
        let on = true;
        fetchPlanPreview(shopId, plan, freeDays === '' || freeDays === undefined ? undefined : Number(freeDays)).then((r) => { if (on) setPv(r.preview || r); }).catch(() => { });
        return () => { on = false; };
    }, [plan, shopId, freeDays]);
    if (!pv) return null;
    const state = (route) => (route ? pv.ownerMenu.find((r) => r.route === route) : null);
    const line = pv.header.endsAt ? `${pv.name}, ends ${day(pv.header.endsAt)} (${pv.header.freeDays} days left)` : pv.name;

    return (
        <View style={{ marginVertical: spacing.sm }}>
            <Text style={{ color: t.muted, fontSize: font.sm, fontWeight: '700', marginBottom: 6 }}>The owner's menu on {pv.name}</Text>
            <View style={{ borderWidth: 6, borderColor: '#1B1B1F', borderRadius: 26, overflow: 'hidden', backgroundColor: t.background, height: 430 }}>
                <ScrollView nestedScrollEnabled showsVerticalScrollIndicator={false}>
                    <View style={{ backgroundColor: t.primary, padding: 14 }}>
                        <Text style={{ color: '#FFFFFF', fontWeight: '900', fontSize: 15 }}>Menu</Text>
                        <Text style={{ color: '#FFFFFF', opacity: 0.9, fontSize: 11.5, marginTop: 2 }}>{line}</Text>
                    </View>
                    {GROUPS.map(([group, rows]) => {
                        const shown = rows.map(([icon, title, route]) => ({ icon, title, route, s: state(route) })).filter((r) => !r.s || r.s.state !== 'hidden');
                        return (
                            <View key={group} style={{ paddingHorizontal: 12, paddingTop: 10 }}>
                                <Text style={{ color: t.muted, fontSize: 11, fontWeight: '800', marginBottom: 4 }}>{group.toUpperCase()}</Text>
                                <View style={{ backgroundColor: t.surface, borderRadius: 14, overflow: 'hidden' }}>
                                    {shown.map((r, i) => {
                                        const locked = r.s && r.s.state === 'locked';
                                        return (
                                            <View key={r.title} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 9, paddingHorizontal: 12, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                                                <Ionicons name={locked ? 'lock-closed' : r.icon} size={17} color={locked ? t.muted : t.primary} />
                                                <View style={{ flex: 1, marginLeft: 10 }}>
                                                    <Text style={{ color: locked ? t.muted : t.text, fontWeight: '700', fontSize: 12.5 }}>{r.title}</Text>
                                                    {locked ? <Text style={{ color: t.warning || t.muted, fontSize: 10.5 }}>Available in {r.s.needs}</Text> : r.route === 'OwnerWallet' ? <Text style={{ color: t.muted, fontSize: 10.5 }}>Rs {pv.header.perOrderFee.minRs} to Rs {pv.header.perOrderFee.maxRs} per order</Text> : null}
                                                </View>
                                                <Ionicons name="chevron-forward" size={14} color={t.muted} />
                                            </View>
                                        );
                                    })}
                                </View>
                            </View>
                        );
                    })}
                    <View style={{ height: 14 }} />
                </ScrollView>
            </View>
        </View>
    );
}
