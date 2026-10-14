import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, Chip, KeyValue } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Group, Switch, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchPlatform, saveAlerts, alertSmsCost } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';
import { rupeesFromPaise, dateTime } from '../../utils/format';

const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

// SMS alerts to your own phone, and what those SMS cost.
export default function AlertSettingsScreen() {
    const t = useTheme();
    const [a, setA] = useState(null);
    const [phone, setPhone] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [days, setDays] = useState(30);
    const [cost, setCost] = useState(null);

    const load = useCallback(async () => {
        try {
            const r = await fetchPlatform();
            const al = r.alerts || {};
            setA({ smsToAdmin: !!al.smsToAdmin, allEvents: !!al.allEvents, phone: al.phone || '' });
            setPhone(al.phone || '');
            setError('');
        } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);

    useEffect(() => {
        setCost(null);
        const to = new Date();
        alertSmsCost({ from: ymd(new Date(to.getTime() - (days - 1) * 86400000)), to: ymd(to) }).then(setCost).catch(() => setCost({ error: true }));
    }, [days]);

    if (!a) return <Screen title="Alert SMS">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={2} avatar={false} />}</Screen>;

    const apply = async (patch, ok) => {
        setBusy(true);
        try {
            const r = await saveAlerts(patch);
            setA({ smsToAdmin: r.alerts.smsToAdmin, allEvents: r.alerts.allEvents, phone: r.alerts.phone || '' });
            setPhone(r.alerts.phone || '');
            toast(ok);
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const phoneOk = /^[6-9]\d{9}$/.test(phone);

    return (
        <Screen title="Alert SMS" subtitle="Alerts to your phone" refreshing={false} onRefresh={load}>
            <Group title="Your number" section="alerts" hint="Alert SMS go to this number. Push alerts on this phone are separate (More → My account).">
                <Field label="Mobile number" value={phone} onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                <Button title="Save number" kind="soft" small loading={busy} disabled={!phoneOk || phone === a.phone} onPress={() => apply({ phone }, 'Number saved')} />
            </Group>

            <Group title="What to send" section="catalog" flush>
                <Switch
                    title="SMS alerts to my phone"
                    subtitle={a.phone ? `To ${a.phone}` : 'Save your number first'}
                    value={a.smsToAdmin}
                    disabled={busy || (!a.phone && !a.smsToAdmin)}
                    onValueChange={(v) => apply({ smsToAdmin: v }, v ? 'SMS alerts are on' : 'SMS alerts are off')}
                />
                <Switch
                    title="Every event, not only critical ones"
                    subtitle="Off = SMS only for critical alerts"
                    value={a.allEvents}
                    disabled={busy}
                    onValueChange={(v) => apply({ allEvents: v }, v ? 'All events will be sent' : 'Only critical alerts')}
                    last
                />
            </Group>

            <Group title="What these SMS cost" section="money">
                <View style={{ height: 48, marginHorizontal: -spacing.lg }}>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                        {[7, 30, 90].map((d) => <Chip key={d} label={`${d} days`} active={days === d} onPress={() => setDays(d)} />)}
                    </ScrollView>
                </View>
                {!cost ? <Text style={{ color: t.muted }}>Working it out…</Text> : cost.error ? <Text style={{ color: t.danger }}>Could not load.</Text> : (
                    <>
                        <KeyValue label="Paid by the platform" value={`${cost.platform.count} SMS · ${rupeesFromPaise(cost.platform.costPaise)}`} />
                        <KeyValue label="Charged to shops" value={`${cost.shops.count} SMS · ${rupeesFromPaise(cost.shops.chargedPaise)}`} last />
                        <Hint>The platform pays when no shop could pay for the alert.</Hint>
                    </>
                )}
            </Group>
        </Screen>
    );
}
