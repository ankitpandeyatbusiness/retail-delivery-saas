import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, KeyValue, SectionTitle } from '../../components/ui';
import { ToggleRow } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchShopAutopilot, pauseShopAutopilot } from '../../api/reportApi';
import { errMsg } from '../../api/adminClient';
import { rupees } from '../../utils/format';

const NAMES = { winback: 'Win-back', welcome: 'Welcome', thanks: 'Thank you', mealtime: 'Meal-time', festival: 'Festival', manual: 'Remind button' };

// What a shop's Autopilot does (reminders to its customers by push and inbox) and a switch that stops it for this shop.
export default function ShopAutopilotScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [a, setA] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(async () => {
        setErr('');
        try { setA(await fetchShopAutopilot(shopId)); } catch (e) { setErr(errMsg(e)); }
    }, [shopId]);
    useEffect(() => { load(); }, [load]);

    const pause = async (paused) => {
        setA((x) => ({ ...x, platformPaused: paused }));
        try { await pauseShopAutopilot(shopId, paused); toast(paused ? 'Autopilot stopped for this shop' : 'Autopilot allowed again'); }
        catch (e) { toast(errMsg(e), 'error'); load(); }
    };

    const on = a ? Object.entries(a.on).filter(([, v]) => v).map(([k]) => k) : [];
    return (
        <Screen title="Autopilot" subtitle={name} onRefresh={load}>
            {!a && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {a ? (
                <>
                    <Card>
                        <ToggleRow title="Stop Autopilot for this shop" subtitle="Nothing is sent to its customers or to the owner until you allow it again. The owner cannot undo this." value={a.platformPaused} onValueChange={pause} last />
                    </Card>
                    <SectionTitle section="platform">What it does</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <KeyValue label="Switched on" value={on.length ? on.join(', ') : 'nothing yet'} />
                        <KeyValue label="Speaks" value={a.language === 'hi' ? 'Hindi' : a.language === 'en' ? 'English' : 'Hinglish'} />
                        <KeyValue label="How often" value={a.frequency} />
                        <KeyValue label="Offer in win-back" value={a.maxDiscount ? `${a.maxDiscount}% off` : 'none'} last />
                    </Card>
                    <SectionTitle section="orders">Last 30 days</SectionTitle>
                    <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                        <KeyValue label="Messages sent" value={String(a.stats.sent)} />
                        <KeyValue label="Customers who came back" value={String(a.stats.broughtBack)} />
                        <KeyValue label="Sales from them" value={rupees(a.stats.revenue)} last />
                    </Card>
                    {Object.keys(a.stats.byKind).length ? (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg, marginTop: spacing.md }}>
                            {Object.entries(a.stats.byKind).map(([k, v], i, all) => <KeyValue key={k} label={NAMES[k] || k} value={`${v.sent} sent · ${v.customers} came back · ${rupees(v.revenue)}`} last={i === all.length - 1} />)}
                        </Card>
                    ) : null}
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>Autopilot never messages someone who ordered today, who turned offers off, or at night, and never sends SMS or email.</Text>
                    {a.platformPaused ? <Badge label="Stopped by you" tone="danger" /> : null}
                </>
            ) : null}
        </Screen>
    );
}
