import React, { useCallback, useEffect, useState } from 'react';
import { Screen } from '../../components/layout';
import { Button } from '../../components/ui';
import { Group, NumberField } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { spacing } from '../../theme';
import { getWatchSettings, saveWatchSettings } from '../../api/ordersApi';
import { errMsg } from '../../api/adminClient';

// Each line: [group, key, label, suffix, what it does]
const GROUPS = [
    ['attention', 'Order counts as stuck (Attention list)', 'An order shows in the Attention list once it has waited this long in one step.', [
        ['accept', 'Shop has not accepted', 'minutes', 'A new order nobody accepted. Suggested 5.'],
        ['cooking', 'Taking too long to prepare', 'minutes', 'Accepted or preparing. Suggested 60.'],
        ['noRider', 'Ready, still no rider', 'minutes', 'A delivery order with no rider after it is ready. Suggested 10.'],
        ['onWay', 'On the way too long', 'minutes', 'Out for delivery. Suggested 60.'],
        ['payment', 'Online payment not completed', 'minutes', 'The customer started to pay and did not finish. Suggested 15.'],
    ]],
    ['alert', 'You are alerted (push to your phone)', 'The shop owner is told first. You are told only if the order is still stuck after this long. Once per order.', [
        ['notAccepted', 'Never accepted', 'minutes', 'A new order the shop did not accept. Suggested 10.'],
        ['notStarted', 'Accepted, not started', 'minutes', 'Suggested 40.'],
        ['slowPrep', 'Still being prepared', 'minutes', 'Suggested 90.'],
        ['noRider', 'Still no rider', 'minutes', 'Suggested 30.'],
        ['onWay', 'Still on the way', 'minutes', 'Suggested 120.'],
    ]],
    ['talk', 'Shop "needs a talk" (Shop quality)', 'A shop is marked when it crosses any of these in the chosen days.', [
        ['shopCancelPct', 'Cancelled by the shop', '%', 'Share of its orders. Suggested 10.'],
        ['prepMin', 'Average time to prepare', 'minutes', 'Suggested 45.'],
        ['deliveryMin', 'Average delivery time', 'minutes', 'Suggested 50.'],
        ['complaintPct', 'Orders with a complaint', '%', 'Suggested 8.'],
        ['minOrders', 'Fewest orders to judge a shop', 'orders', 'A shop with fewer orders is not judged. Suggested 10.'],
    ]],
];

// The numbers behind the Orders tab. Saved for the whole platform; "Use suggested" puts the defaults back.
export default function OrderLimitsScreen() {
    const [f, setF] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { setF((await getWatchSettings()).values); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!f) return <Screen title="Order limits">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const set = (g, k) => (v) => setF({ ...f, [g]: { ...f[g], [k]: v } });
    const run = async (body, msg) => {
        setBusy(true);
        try { setF((await saveWatchSettings(body)).values); toast(msg); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Order limits" subtitle="When an order is stuck and when to alert you" footer={<Button title="Save" icon="check" onPress={() => run(f, 'Saved')} loading={busy} />}>
            {GROUPS.map(([g, title, hint, rows]) => (
                <Group key={g} title={title} hint={hint} section="orders">
                    {rows.map(([k, label, suffix, h], i) => (
                        <NumberField key={k} label={label} suffix={suffix} integer value={f[g][k]} onChange={set(g, k)} hint={h} last={i === rows.length - 1} />
                    ))}
                </Group>
            ))}
            <Button title="Use suggested numbers" icon="refresh" kind="outline" onPress={() => run({ reset: true }, 'Suggested numbers are back')} loading={busy} style={{ marginTop: spacing.lg }} />
        </Screen>
    );
}
