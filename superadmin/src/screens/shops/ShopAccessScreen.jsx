import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Badge, IconTile } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ConfirmSheet, Sheet, toast } from '../../components/feedback';
import { setOwnerAccess, setMaintenance } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { useShopStore } from '../../store/useShopStore';
import { dateTime } from '../../utils/format';

const HOURS = [{ label: '1 hour', h: 1 }, { label: '3 hours', h: 3 }, { label: '12 hours', h: 12 }, { label: 'Until I turn it off', h: 0 }];

// Two switches only the platform owner holds. Both always ask first and both are written to the audit log.
export default function ShopAccessScreen() {
    const t = useTheme();
    const { shopId } = useRoute().params;
    const rec = useShopStore((s) => s.byId[shopId]);
    const [sheet, setSheet] = useState(null);   // 'block' | 'unblock' | 'maint-on' | 'maint-off'
    const [message, setMessage] = useState('');
    const [hours, setHours] = useState(1);

    if (!rec) return <Screen title="Access and maintenance"><SkeletonList count={4} /></Screen>;
    const { tenant } = rec;
    const maintOn = !!tenant.maintenance?.on && (!tenant.maintenance.until || new Date(tenant.maintenance.until) > new Date());
    const refresh = () => useShopStore.getState().load(shopId, { quiet: true });

    const run = (fn, ok) => async (reason) => {
        try { await fn(reason); toast(ok); await refresh(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };

    return (
        <Screen title="Access and maintenance" subtitle={tenant.name}>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <IconTile icon="shield" section="alerts" />
                    <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800', marginLeft: spacing.md }}>Owner panel</Text>
                </View>
                <Text style={{ color: t.muted, marginTop: spacing.md, marginBottom: spacing.md }}>
                    Locks the owner out of the shop panel. Customers only see "not accepting orders right now".
                </Text>
                <Badge label={tenant.ownerBlocked ? 'Blocked' : 'Allowed'} tone={tenant.ownerBlocked ? 'danger' : 'success'} />
                {tenant.ownerBlocked && tenant.ownerBlockedReason ? (
                    <Text style={{ color: t.muted, marginTop: spacing.sm }}>Reason: {tenant.ownerBlockedReason}</Text>
                ) : null}
                <Button
                    style={{ marginTop: spacing.lg }}
                    kind={tenant.ownerBlocked ? 'soft' : 'dangerSoft'}
                    title={tenant.ownerBlocked ? 'Allow owner again' : 'Block owner panel'}
                    onPress={() => setSheet(tenant.ownerBlocked ? 'unblock' : 'block')}
                />
            </Card>

            <SectionTitle section="catalog">Maintenance</SectionTitle>
            <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <IconTile icon="tool" section="catalog" />
                    <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '800', marginLeft: spacing.md }}>This shop's app</Text>
                </View>
                <Text style={{ color: t.muted, marginTop: spacing.md, marginBottom: spacing.md }}>
                    Customers and the owner get a maintenance message. Other shops are not affected.
                </Text>
                <Badge label={maintOn ? 'In maintenance' : 'Running normally'} tone={maintOn ? 'warn' : 'success'} />
                {maintOn ? (
                    <Text style={{ color: t.muted, marginTop: spacing.sm }}>
                        {tenant.maintenance.until ? `Ends ${dateTime(tenant.maintenance.until)}` : 'Stays on until you turn it off'}
                        {tenant.maintenance.message ? `\n“${tenant.maintenance.message}”` : ''}
                    </Text>
                ) : null}
                <Button
                    style={{ marginTop: spacing.lg }}
                    kind={maintOn ? 'soft' : 'outline'}
                    title={maintOn ? 'Turn maintenance off' : 'Start maintenance'}
                    onPress={() => (maintOn ? setSheet('maint-off') : setSheet('maint-on'))}
                />
            </Card>

            <ConfirmSheet
                visible={sheet === 'block'}
                onClose={() => setSheet(null)}
                title="Block the owner panel?"
                message="The owner cannot open the shop panel until you allow it again. A private reason is kept for your records."
                confirmLabel="Block owner"
                danger
                needReason
                reasonLabel="Reason (not shown to the owner)"
                onConfirm={run((reason) => setOwnerAccess(shopId, true, reason), 'Owner panel blocked')}
            />
            <ConfirmSheet
                visible={sheet === 'unblock'}
                onClose={() => setSheet(null)}
                title="Allow the owner again?"
                confirmLabel="Allow owner"
                onConfirm={run(() => setOwnerAccess(shopId, false), 'Owner panel allowed')}
            />
            <ConfirmSheet
                visible={sheet === 'maint-off'}
                onClose={() => setSheet(null)}
                title="Turn maintenance off?"
                message="The shop's app opens normally again."
                confirmLabel="Turn off"
                onConfirm={run(() => setMaintenance(shopId, { on: false }), 'Maintenance is off')}
            />

            <Sheet visible={sheet === 'maint-on'} onClose={() => setSheet(null)} title="Start maintenance">
                <Field label="Message shown in the app" value={message} onChangeText={setMessage} maxLength={200} placeholder="We will be back soon" multiline />
                <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '600', marginBottom: 8 }}>How long</Text>
                {HOURS.map((o) => (
                    <Button
                        key={o.label}
                        title={o.label}
                        kind={hours === o.h ? 'primary' : 'outline'}
                        onPress={() => setHours(o.h)}
                        style={{ marginBottom: spacing.sm }}
                        small
                    />
                ))}
                <Button
                    title="Start maintenance"
                    style={{ marginTop: spacing.md }}
                    onPress={async () => {
                        const body = { on: true, message: message.trim(), ...(hours ? { until: new Date(Date.now() + hours * 3600 * 1000).toISOString() } : {}) };
                        try { await setMaintenance(shopId, body); toast('Maintenance started'); setSheet(null); setMessage(''); await refresh(); } catch (e) { toast(errMsg(e), 'error'); }
                    }}
                />
            </Sheet>
        </Screen>
    );
}
