import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, SectionTitle } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { Choice, Hint } from '../../components/settingsForm';
import { ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { fetchPlatform, saveMaintenance } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';
import { dateTime } from '../../utils/format';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchMaintenancePlans, cancelMaintenancePlan } from '../../api/exportApi';

const STATUS = { planned: ['Planned', 'warn'], active: ['Running now', 'danger'], ended: ['Done', 'success'], cancelled: ['Cancelled', 'neutral'] };

const HOURS = [
    { value: 1, label: '1 hour' }, { value: 3, label: '3 hours' }, { value: 12, label: '12 hours' }, { value: 0, label: 'Until I switch it off' },
];

// Puts EVERY shop's app into maintenance. Your own superadmin app keeps working.
export default function MaintenanceScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const supreme = useSupreme();
    const [plans, setPlans] = useState([]);
    const [cancelId, setCancelId] = useState(null);
    const loadPlans = useCallback(() => { fetchMaintenancePlans().then((r) => setPlans(r.items)).catch(() => { }); }, []);
    useFocusEffect(useCallback(() => { loadPlans(); }, [loadPlans]));
    const [m, setM] = useState(null);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [hours, setHours] = useState(1);
    const [confirm, setConfirm] = useState(null);

    const load = useCallback(async () => {
        try {
            const r = await fetchPlatform();
            setM(r.maintenance || { on: false });
            setMessage(r.maintenance?.message || '');
            setError('');
        } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (!m) return <Screen title="Maintenance" subtitle="All shops">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const on = !!m.on && (!m.until || new Date(m.until) > new Date());
    const turn = async (body, ok) => {
        try { await saveMaintenance(body); toast(ok); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };

    return (
        <Screen title="Maintenance" subtitle="All shops at once">
            <Hero section={on ? 'alerts' : 'money'} title={on ? 'Maintenance is ON' : 'Everything is running'} subtitle={on ? 'Every shop app shows the maintenance message.' : 'Customers and owners can use their apps.'} right={<Badge label={on ? 'ON' : 'OFF'} tone={on ? 'danger' : 'success'} />}>
                {on ? (
                    <View style={{ marginTop: spacing.md }}>
                        <Text style={{ color: t.text }}>{m.message || 'Default message'}</Text>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 4 }}>{m.until ? `Ends ${dateTime(m.until)}` : 'Stays on until you switch it off'}</Text>
                    </View>
                ) : null}
            </Hero>

            {!supreme ? <Hint tone="warn">Switching every shop on or off is for the supreme admin. You can plan maintenance for the shops you choose below.</Hint> : on ? (
                <Button title="Switch maintenance off" icon="ok" style={{ marginTop: spacing.lg }} onPress={() => setConfirm('off')} />
            ) : (
                <>
                    <Card style={{ marginTop: spacing.lg }}>
                        <Field label="Message shown in every app" value={message} onChangeText={setMessage} multiline maxLength={200} placeholder="We are upgrading. Back soon." />
                        <Choice label="For how long" options={HOURS} value={hours} onChange={setHours} last />
                    </Card>
                    <Button title="Start maintenance for all shops" icon="tool" kind="danger" style={{ marginTop: spacing.lg }} onPress={() => setConfirm('on')} />
                    <Hint tone="warn">Use this for upgrades only. No customer in any shop can order while it is on.</Hint>
                </>
            )}

            <SectionTitle section="alerts">Planned maintenance</SectionTitle>
            <Button title="Plan a maintenance" icon="clock" kind="outline" onPress={() => nav.navigate('MaintenancePlan')} />
            <Hint>Warn everybody first, then every chosen shop pauses at the exact time and opens at the end time. For every shop, chosen shops or one brand.</Hint>
            {plans.slice(0, 8).map((p) => (
                <Card key={p.id} style={{ marginTop: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }}>{dateTime(p.startAt)}{p.endAt ? ` to ${new Date(p.endAt).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' })}` : ' until switched off'}</Text>
                        <Badge label={STATUS[p.status][0]} tone={STATUS[p.status][1]} />
                    </View>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{p.scope === 'all' ? 'Every shop' : p.scope === 'brand' ? `Brand ${p.brandName} (${p.shops} branches)` : (p.shopNames.length ? p.shopNames.join(', ') + (p.shops > p.shopNames.length ? ` and ${p.shops - p.shopNames.length} more` : '') : `${p.shops} shops`)}{p.message ? ` · ${p.message}` : ''}</Text>
                    {p.status === 'planned' || p.status === 'active' ? <Button small kind="outline" title={p.status === 'active' ? 'End it now' : 'Cancel it'} onPress={() => setCancelId(p.id)} style={{ marginTop: spacing.sm }} /> : null}
                </Card>
            ))}
            <ConfirmSheet
                visible={!!cancelId}
                onClose={() => setCancelId(null)}
                title="Cancel this plan?"
                message="A plan that has not started is cancelled and people are told. A running one is ended now and the shops open."
                confirmLabel="Yes, do it"
                danger
                onConfirm={async () => { try { await cancelMaintenancePlan(cancelId); toast('Done'); loadPlans(); load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } }}
            />
            <ConfirmSheet
                visible={confirm === 'on'}
                onClose={() => setConfirm(null)}
                title="Stop ALL shops?"
                message="Every shop's customers and owners see the maintenance message and cannot order until you switch it off."
                confirmLabel="Start maintenance"
                danger
                onConfirm={() => turn({ on: true, message: message.trim(), ...(hours ? { until: new Date(Date.now() + hours * 3600000).toISOString() } : {}) }, 'Maintenance started')}
            />
            <ConfirmSheet
                visible={confirm === 'off'}
                onClose={() => setConfirm(null)}
                title="Switch maintenance off?"
                message="All shop apps open normally again."
                confirmLabel="Switch off"
                onConfirm={() => turn({ on: false }, 'Maintenance is off')}
            />
        </Screen>
    );
}
