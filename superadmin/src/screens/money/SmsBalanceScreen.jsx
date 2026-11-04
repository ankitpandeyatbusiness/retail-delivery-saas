import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, SectionTitle } from '../../components/ui';
import { Group, NumberField } from '../../components/settingsForm';
import { ToggleRow, Segmented } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import api, { data, errMsg } from '../../api/adminClient';
import { rupeesFromPaise, ago } from '../../utils/format';

const get = () => data(api.get('/admin/platform/sms-balance'));
const put = (body) => data(api.put('/admin/platform/sms-balance', body));
const check = () => data(api.post('/admin/platform/sms-balance/check'));
const added = (amountPaise) => data(api.post('/admin/platform/sms-balance/added', { amountPaise }));

const LEVEL = { ok: ['Enough', 'success'], low: ['Getting low', 'warn'], empty: ['Almost empty', 'danger'], unknown: ['Not known yet', 'neutral'] };

// Your balance at the SMS provider (MSG91): asked from the provider every 30 minutes, or an estimate from what you tell us. Two lines: low (warn) and reserve (only OTPs go).
export default function SmsBalanceScreen() {
    const t = useTheme();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState('');
    const [low, setLow] = useState(0);
    const [reserve, setReserve] = useState(0);
    const [sheet, setSheet] = useState(false);
    const [amount, setAmount] = useState(undefined);
    const [said, setSaid] = useState('');

    const apply = (x) => { setD(x); setLow(Math.round(x.lowPaise / 100)); setReserve(Math.round(x.reservePaise / 100)); };
    const load = useCallback(async () => { try { apply(await get()); setError(''); } catch (e) { setError(errMsg(e)); } }, []);
    useEffect(() => { load(); }, [load]);

    if (!d) return <Screen title="SMS balance">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;

    const run = async (key, fn, ok) => { setBusy(key); try { const r = await fn(); if (ok) toast(ok); return r; } catch (e) { toast(errMsg(e), 'error'); return null; } finally { setBusy(''); } };
    const saveLines = async () => { const r = await run('lines', () => put({ lowPaise: Math.round(low * 100), reservePaise: Math.round(reserve * 100) }), 'Saved'); if (r) apply(r); };
    const askNow = async () => {
        const r = await run('check', check);
        if (!r) return;
        apply(r.current);
        if (r.result?.skipped) setSaid('The server is in test mode (no real SMS), so there is nothing to ask.');
        else if (r.result?.ok) { setSaid(`The provider answered: ${r.result.raw}`); toast('Balance updated'); } else setSaid(`Could not ask the provider: ${r.result?.error || 'no answer'}`);
    };
    const saveAdded = async () => { const r = await run('added', () => added(Math.round((amount || 0) * 100)), 'Saved'); if (r) { apply({ ...d, ...r }); setSheet(false); } };

    const [lvl, tone] = LEVEL[d.level] || LEVEL.unknown;
    return (
        <Screen title="SMS balance" subtitle="Your account at the SMS provider" onRefresh={load}>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Text style={{ color: t.muted, fontWeight: '700', fontSize: font.sm }}>LEFT AT YOUR PROVIDER</Text>
                    <Badge label={lvl} tone={tone} />
                </View>
                <Text style={{ color: t.text, fontSize: font.xxl, fontWeight: '800', marginTop: 2 }}>{d.paise === null ? '—' : rupeesFromPaise(d.paise)}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                    {d.source === 'provider' ? `Asked from the provider ${ago(d.at)}` : d.source === 'estimate' ? `An estimate from the balance you told us ${ago(d.at)}, minus the SMS sent since` : 'Not known yet. Ask the provider, or tell us the balance below.'}
                </Text>
                {d.lastCheck && d.lastCheck.ok === false ? <Text style={{ color: t.danger, fontSize: font.xs, marginTop: spacing.sm }}>Last check failed: {d.lastCheck.error}</Text> : null}
                {said ? <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>{said}</Text> : null}
            </Card>
            <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
                <View style={{ flex: 1, marginRight: spacing.sm }}><Button title="Ask the provider now" icon="refresh" kind="soft" onPress={askNow} loading={busy === 'check'} /></View>
                <View style={{ flex: 1 }}><Button title="I added money" icon="rupee" kind="soft" onPress={() => { setAmount(d.paise === null ? undefined : Math.round(d.paise / 100)); setSheet(true); }} /></View>
            </View>
            {!d.keyOnServer && !d.mock ? <Text style={{ color: t.danger, fontSize: font.sm, marginTop: spacing.md }}>The server has no SMS key (SMS_AUTH_KEY), so it cannot ask the provider. Use "I added money" for an estimate.</Text> : null}

            <Group title="Your two lines" hint="Low warns you. Below the reserve, shop messages stop so the last credits keep login OTPs working." section="money">
                <NumberField label="Warn me below" suffix="₹" integer value={low} onChange={(v) => setLow(v || 0)} hint="You get a push once, and again if it keeps falling." />
                <NumberField label="Reserve (almost empty)" suffix="₹" integer value={reserve} onChange={(v) => setReserve(v || 0)} hint="A critical alert, and the pause below starts." last />
            </Group>
            <Button title="Save the lines" icon="check" onPress={saveLines} loading={busy === 'lines'} style={{ marginTop: spacing.md }} />

            <SectionTitle section="settings">Keep login working</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ToggleRow title="Pause shop messages below the reserve" subtitle="Order, bill and shop alert SMS wait. Login OTPs and your own alerts always go. A shop on its own provider account is never touched." value={d.protectOtp} onValueChange={async (v) => { const r = await run('prot', () => put({ protectOtp: v }), v ? 'On' : 'Off'); if (r) apply(r); }} last />
            </Card>

            <SectionTitle section="settings">What the provider's number means</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg, paddingVertical: spacing.md }}>
                <Segmented value={d.unit} onChange={async (v) => { const r = await run('unit', () => put({ unit: v }), 'Saved'); if (r) apply(r); }} options={[{ value: 'rupees', label: 'Rupees' }, { value: 'sms', label: 'SMS credits' }]} />
                <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.sm }}>If the provider reports your balance in SMS credits, choose SMS credits: it is then turned into rupees with your cost per SMS (₹{(d.costPerSmsPaise / 100).toFixed(2)}). Press "Ask the provider now" once to see what it says.</Text>
            </Card>

            <Sheet visible={sheet} onClose={() => setSheet(false)} title="What is the balance now?">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>Open your provider's dashboard and type the balance you see (or what it is after you added money). The estimate counts down from this.</Text>
                <NumberField label="Balance now" suffix="₹" integer value={amount} onChange={setAmount} placeholder="e.g. 2000" last />
                <Button title="Save" icon="check" onPress={saveAdded} loading={busy === 'added'} disabled={amount === undefined} style={{ marginTop: spacing.md }} />
            </Sheet>
        </Screen>
    );
}
