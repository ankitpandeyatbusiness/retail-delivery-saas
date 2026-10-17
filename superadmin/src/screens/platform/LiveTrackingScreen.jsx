import React, { useCallback, useEffect, useState } from 'react';
import { Text } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, KeyValue } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { Group, Choice, Hint } from '../../components/settingsForm';
import { ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchTracking, saveTracking } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';

const MODES = [
    { value: 'socket', label: 'Live (socket)' }, { value: 'polling', label: 'Polling' }, { value: 'off', label: 'Off' },
];
const WORDS = {
    socket: 'Live. Phones keep a connection open and see the rider move at once.',
    polling: 'Polling. No new connections; phones ask for the position every few seconds. Use it when the server struggles.',
    off: 'Off. Nobody sees a live rider.',
};
const num = (v) => (v === '' || v == null ? null : Number(v));
const digits = (v) => v.replace(/\D/g, '');

// How live tracking is doing, and the switch. Everybody with a superadmin login can look; only the supreme admin changes it.
// [name in the server's usage list, setting, label]: best first
const GOOGLE_ROWS = [
    ['route_pro', 'routeProCap', 'Road routes with traffic per month (best, first)'],
    ['route_ess', 'routeCap', 'Road routes without traffic per month'],
    ['text_search', 'textSearchCap', 'Place search by name per month (best, first)'],
    ['autocomplete', 'autocompleteCap', 'Place suggestions per month'],
    ['details', 'detailsCap', 'Picked place address and point per month'],
];

export default function LiveTrackingScreen() {
    const t = useTheme();
    const supreme = useSupreme();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [confirm, setConfirm] = useState(null);
    const [caps, setCaps] = useState({ maxSockets: '', pollSec: '', routeProCap: '', routeCap: '', textSearchCap: '', autocompleteCap: '', detailsCap: '' });
    const [editing, setEditing] = useState(false);

    const load = useCallback(async () => {
        try {
            const r = await fetchTracking();
            setD(r);
            // the numbers being typed are not overwritten by the 15-second refresh
            setCaps((c) => (editing ? c : Object.fromEntries(Object.keys(c).map((k) => [k, String(r.settings[k] ?? '')]))));
            setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [editing]);
    useEffect(() => { load(); const id = setInterval(load, 15000); return () => clearInterval(id); }, [load]);

    if (!d) return <Screen title="Live tracking" subtitle="Riders on the map">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const apply = async (body, ok) => {
        setBusy(true);
        try { await saveTracking(body); toast(ok); setEditing(false); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setBusy(false); }
    };
    const st = d.status;
    const auto = !!d.counters?.autoUntil && new Date(d.counters.autoUntil) > new Date();
    const changed = Object.keys(caps).some((k) => String(d.settings[k]) !== caps[k]);
    const r = d.routes || {};
    const set = (k) => (v) => { setEditing(true); setCaps((c) => ({ ...c, [k]: digits(v) })); };
    const label = (m) => MODES.find((x) => x.value === m)?.label || m;

    return (
        <Screen title="Live tracking" subtitle="Riders on the map" refreshing={false} onRefresh={load}>
            <Hero section={st.mode === 'socket' ? 'money' : 'alerts'} title={label(st.mode)} subtitle={WORDS[st.mode]}>
                {auto ? <Badge label="The server switched itself to polling for a while" tone="warn" /> : null}
            </Hero>

            <Group title="Right now" section="platform">
                <KeyValue label="Phones connected" value={`${d.sockets} of ${d.settings.maxSockets}`} />
                <KeyValue label="Riders sending" value={String(d.ridersLive)} />
                <KeyValue label="Positions received" value={String(d.counters.pings)} />
                <KeyValue label="Sent by the web fallback" value={String(d.counters.httpFallbacks)} />
                <KeyValue label="Connections refused (busy)" value={String(d.counters.refused)} />
                <KeyValue label="Too-fast pings dropped" value={String(d.counters.droppedPings)} />
                <KeyValue label="Server delay (worst)" value={`${d.counters.lagMaxMs} ms`} />
                <KeyValue label="Memory used" value={`${d.counters.heapPercent}%`} last />
            </Group>

            <Group title="Road routes (Google)" section="money" hint="Each trip asks Google for one route. After the monthly cap the apps use a straight-line estimate and nothing is billed.">
                <KeyValue label="Source now" value={r.provider === 'google' ? 'Google' : 'Estimate only'} />
                <KeyValue label="Used this month" value={`${r.usedThisMonth || 0} of ${d.settings.routeCap}`} />
                <KeyValue label="Estimates given" value={String(r.estimates || 0)} />
                <KeyValue label="Google paused after failures" value={r.breakerOpen ? 'Yes, for a few minutes' : 'No'} last />
                {r.lastError ? <Hint>Last problem: {r.lastError}</Hint> : null}
            </Group>

            <Group title="Google maps use this month" section="money" hint="Each is kept just under Google's free allowance. The best kind is used first; when it is used up the next, cheaper kind takes over, and at the end a free source, so nothing is billed.">
                {GOOGLE_ROWS.map(([key, field], i) => {
                    const g = d.google?.[key] || { used: 0, cap: d.settings[field] };
                    return <KeyValue key={key} label={g.label || key} value={`${g.used} of ${g.cap}`} last={i === GOOGLE_ROWS.length - 1} />;
                })}
            </Group>

            {supreme ? (
                <>
                    <Group title="The switch" section="alerts" hint="Polling asks every phone to stop using sockets and ask every few seconds instead. Live returns when you switch back.">
                        <Choice options={MODES} value={d.settings.mode} onChange={(v) => { if (v !== d.settings.mode) setConfirm(v); }} last />
                    </Group>
                    <Group title="Limits" section="settings">
                        <Field label="Most phones connected at once" value={caps.maxSockets} onChangeText={set('maxSockets')} keyboardType="number-pad" />
                        <Field label="Polling: ask every (seconds)" value={caps.pollSec} onChangeText={set('pollSec')} keyboardType="number-pad" />
                        {GOOGLE_ROWS.map(([key, field, title]) => <Field key={field} label={title} value={caps[field]} onChangeText={set(field)} keyboardType="number-pad" />)}
                        <Button title="Save limits" loading={busy} disabled={!changed} onPress={() => apply(Object.fromEntries(Object.entries(caps).map(([k, v]) => [k, num(v)])), 'Limits saved').catch(() => { })} />
                        <Button title="Back to the recommended values" kind="outline" small onPress={() => setConfirm('reset')} style={{ marginTop: spacing.sm }} />
                    </Group>
                </>
            ) : (
                <Card><Text style={{ color: t.muted, fontSize: font.sm }}>Only the supreme admin can change the switch and the limits.</Text></Card>
            )}

            <ConfirmSheet
                visible={!!confirm}
                onClose={() => setConfirm(null)}
                title={confirm === 'reset' ? 'Back to the recommended values?' : `Switch to ${label(confirm)}?`}
                message={confirm === 'off' ? 'Customers and owners will no longer see riders move.' : confirm === 'polling' ? 'Every phone will be asked to ask for the position instead of keeping a connection.' : confirm === 'reset' ? 'Mode, limits and the monthly route cap return to their defaults.' : 'Phones can open live connections again.'}
                confirmLabel="Yes, do it"
                onConfirm={() => apply(confirm === 'reset' ? { reset: true } : { mode: confirm }, confirm === 'reset' ? 'Reset' : 'Switched')}
            />
        </Screen>
    );
}
