import React, { useCallback, useState } from 'react';
import { View, Text, Share } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, Badge } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { fetchDevDetails, saveDevNotes } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { dateTime, ago, paise } from '../../utils/format';

// cards have no outside space of their own: this one keeps a gap above it so stacked cards never touch
const Box = ({ style, ...p }) => <Card {...p} style={[{ marginTop: spacing.md }, style]} />;

const yn = (v) => (v ? 'Yes' : 'No');
const when = (d) => (d ? `${dateTime(d)} (${ago(d)})` : 'Never');

// A block of text a developer can select and copy (long-press), such as a command or a config line
function Code({ children }) {
    const t = useTheme();
    return (
        <Text selectable style={{ color: t.text, backgroundColor: t.surfaceAlt, padding: spacing.md, borderRadius: 10, fontSize: font.sm, fontFamily: 'monospace', marginTop: spacing.sm }}>
            {children}
        </Text>
    );
}

// Everything a developer needs to know about this shop's app, in one place. Read only, never a secret.
export default function ShopDevScreen() {
    const t = useTheme();
    const { shopId, name } = useRoute().params;
    const [d, setD] = useState(null);
    const [err, setErr] = useState('');
    const [notes, setNotes] = useState('');
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try {
            const x = await fetchDevDetails(shopId);
            setD(x);
            setNotes(x.notes || '');
            setErr('');
        } catch (e) { setErr(errMsg(e)); }
    }, [shopId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!d) {
        return (
            <Screen title="Development details" subtitle={name}>
                {err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={4} />}
            </Screen>
        );
    }

    const { identity: i, build: b, appVersion: v, payments: p, sms: s, data: x, config: c, server: sv } = d;

    const saveNotes = async () => {
        setSaving(true);
        try { await saveDevNotes(shopId, notes); toast('Notes saved'); } catch (e) { toast(errMsg(e), 'error'); }
        setSaving(false);
    };

    const report = () => [
        `${i.name} (${i.slug})`,
        `APP_TENANT: ${i.APP_TENANT}`,
        `Android package: ${i.androidPackage || 'not set'}`,
        `Tenant id: ${i.tenantId}`,
        `API: ${i.apiBaseUrl}`,
        `Min app version: ${v.minVersion || 'none'}`,
        `Versions seen: ${v.seen.map((r) => `${r.version}${r.build ? `(${r.build})` : ''} ${r.platform || ''}`).join(', ') || 'none yet'}`,
        `Razorpay: ${p.enabled ? 'on' : 'off'} ${p.mode || ''} ${p.keyIdMasked || ''}`,
        `Webhook: ${p.webhookUrl}`,
        `SMS: ${s.useOwnSender ? 'own sender' : 'platform sender'} ${s.senderId || ''} entity ${s.entityId || '-'}`,
        '',
        ...b.commands.powershell,
    ].join('\n');

    return (
        <Screen title="Development details" subtitle={i.name} refreshing={refreshing} onRefresh={refresh}>
            <Box>
                <Text style={{ color: t.muted }}>
                    For building and fixing this shop's app. Long-press any value to copy it. Secrets are never shown: only whether they exist.
                </Text>
                <Button style={{ marginTop: spacing.md }} kind="soft" title="Share all these details" onPress={() => Share.share({ message: report() })} />
            </Box>

            <SectionTitle section="settings">App identity</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="APP_TENANT" value={i.APP_TENANT} />
                <KeyValue label="Shop name" value={i.name} />
                <KeyValue label="Android package" value={i.androidPackage || 'Not set (Edit shop)'} />
                <KeyValue label="Tenant id" value={i.tenantId} />
                <KeyValue label="Business type" value={i.businessType} />
                <KeyValue label="Status" value={i.state?.acceptingOrders ? `${i.status}, taking orders` : `${i.status}, not taking orders${i.state?.reasons?.length ? `: ${i.state.reasons.join(", ")}` : ""}`} />
                <KeyValue label="Created" value={dateTime(i.createdAt)} />
                <KeyValue label="Last changed" value={when(i.updatedAt)} last />
            </Box>

            <SectionTitle section="platform">App version</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="Latest version seen" value={v.latestSeen || 'None yet'} />
                <KeyValue label="Minimum allowed" value={v.minVersion || 'No minimum'} last />
            </Box>
            {v.seen.length ? (
                <Box>
                    {v.seen.map((r, k) => (
                        <View key={`${r.version}${r.build}${r.platform}`} style={{ paddingVertical: spacing.sm, borderTopWidth: k ? 1 : 0, borderTopColor: t.border }}>
                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>
                                {r.version}{r.build ? ` · build ${r.build}` : ''} · {r.platform || 'unknown'}{r.osVersion ? ` ${r.osVersion}` : ''}
                            </Text>
                            <Text style={{ color: t.muted, fontSize: font.sm }}>Last seen {when(r.lastSeenAt)} · first {dateTime(r.firstSeenAt)}</Text>
                        </View>
                    ))}
                </Box>
            ) : <Box><Text style={{ color: t.muted }}>{v.tracking}</Text></Box>}
            <Text style={{ color: t.muted, fontSize: font.sm, marginHorizontal: spacing.lg, marginTop: spacing.xs }}>
                Seen = the versions customers' phones reported when they used the app. Older rows disappear after 180 days.
            </Text>

            <SectionTitle section="money">Razorpay (online payments)</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="Switched on" value={yn(p.enabled)} />
                <KeyValue label="Mode" value={p.mode ? p.mode.toUpperCase() : 'No keys'} />
                <KeyValue label="Key id" value={p.keyIdMasked} />
                <KeyValue label="Key secret saved" value={yn(p.hasKeySecret)} />
                <KeyValue label="Webhook secret saved" value={yn(p.hasWebhookSecret)} />
                <KeyValue label="Connection tested" value={when(p.verifiedAt)} />
                <KeyValue label="Last webhook" value={when(p.lastWebhookAt)} />
                <KeyValue label="Methods in the app" value={(p.methodsInApp || []).join(', ') || '—'} last />
            </Box>
            <Box>
                <Text style={{ color: t.muted }}>Webhook URL to paste in the shop's Razorpay dashboard:</Text>
                <Code>{p.webhookUrl}</Code>
                {p.warnings.map((w) => <Text key={w} style={{ color: t.danger, marginTop: spacing.sm }}>{w}</Text>)}
            </Box>

            <SectionTitle section="alerts">SMS and DLT</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="Sender used" value={s.useOwnSender ? "This shop's own" : 'Platform sender'} />
                <KeyValue label="Sender id (header)" value={s.senderId} />
                <KeyValue label="DLT entity id" value={s.entityId} />
                <KeyValue label="Shop template id" value={s.shopTemplateId} />
                <KeyValue label="Own provider key saved" value={s.useOwnSender ? yn(s.ownProviderKey) : 'Not used'} />
                <KeyValue label="Platform auth key set" value={yn(s.platformAuthKey)} />
                <KeyValue label="Wallet balance" value={s.wallet ? paise(s.wallet.balancePaise) : 'No wallet yet'} />
                <KeyValue label="Last 30 days" value={Object.entries(s.last30Days).map(([k, n]) => `${n} ${k}`).join(', ') || 'No SMS'} />
                <KeyValue label="Last SMS" value={s.lastSms ? `${s.lastSms.purpose} · ${s.lastSms.status} · ${when(s.lastSms.at)}` : 'None'} last />
            </Box>
            {Object.keys(s.ownTemplateIds || {}).length ? (
                <Box>
                    <Text style={{ color: t.muted }}>This shop's DLT template ids</Text>
                    {Object.entries(s.ownTemplateIds).map(([k, val]) => <Code key={k}>{`${k}: ${val}`}</Code>)}
                </Box>
            ) : null}
            {s.mockMode ? <View style={{ marginTop: spacing.md, flexDirection: "row" }}><Badge label="SMS is in mock mode on this server: nothing is really sent" tone="warn" /></View> : null}

            <SectionTitle section="catalog">Build and release</SectionTitle>
            <Box>
                <Text style={{ color: t.muted }}>Entry for tenantConfigs in mobile/app.config.js</Text>
                <Code>{b.tenantConfigsEntry}</Code>
                <Text style={{ color: t.muted, marginTop: spacing.md }}>PowerShell</Text>
                <Code>{b.commands.powershell.join('\n')}</Code>
                <Text style={{ color: t.muted, marginTop: spacing.md }}>Bash</Text>
                <Code>{b.commands.bash.join('\n')}</Code>
            </Box>
            <Box style={{ paddingVertical: 0 }}>
                {b.env.map((e, k) => <KeyValue key={e.key} label={e.key} value={e.value || e.note || 'Not set'} last={k === b.env.length - 1} />)}
            </Box>
            <Box style={{ paddingVertical: 0 }}>
                {b.branding.files.map((f) => <KeyValue key={f.name} label={f.name} value={f.uploaded ? 'Uploaded' : 'Missing: the build will fail'} />)}
                <KeyValue label="Logo" value={yn(b.branding.logoUploaded)} />
                <KeyValue label="Home pictures" value={String(b.branding.heroImages)} />
                <KeyValue label="Firebase file" value={b.firebase.file} />
                <KeyValue label="Push devices" value={String(b.firebase.tokensRegistered)} last />
            </Box>
            <Box><Text selectable style={{ color: t.muted, fontSize: font.sm }}>Branding folder: {b.branding.folder}{'\n'}{b.firebase.note}</Text></Box>

            <SectionTitle section="shops">Live data</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="Customers" value={String(x.customers)} />
                <KeyValue label="Owner logins" value={String(x.owners)} />
                <KeyValue label="Riders" value={`${x.riders} active`} />
                <KeyValue label="Items / categories" value={`${x.products} / ${x.categories}`} />
                <KeyValue label="Orders" value={`${x.orders} total, ${x.orders30Days} in 30 days`} />
                <KeyValue label="Last order" value={x.lastOrderAt ? `#${x.lastOrderNo} · ${when(x.lastOrderAt)}` : 'None'} />
                <KeyValue label="Logged-in devices" value={String(x.activeSessions)} />
                <KeyValue label="Push by platform" value={x.devices.map((dv) => `${dv.platform}: ${dv.count}`).join(', ') || 'None'} last />
            </Box>

            <SectionTitle section="settings">Current setup</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="Light / dark theme" value={`${c.look.lightLook} / ${c.look.darkLook}`} />
                <KeyValue label="Header · tabs · categories" value={`${c.look.headerStyle} · ${c.look.tabBarStyle} · ${c.look.categoryStyle}`} />
                <KeyValue label="Filters · location · motion" value={`${c.look.filterStyle} · ${c.look.locationStyle} · ${c.look.motion}`} />
                <KeyValue label="Accepting orders" value={yn(c.acceptingOrders)} />
                <KeyValue label="Order types" value={(c.orderTypes || []).join(', ')} />
                <KeyValue label="GSTIN" value={c.gst.gstin} />
                <KeyValue label="FSSAI" value={c.gst.fssai} />
                <KeyValue label="Map pin" value={c.delivery.latitude != null ? `${c.delivery.latitude}, ${c.delivery.longitude}` : 'Not set'} />
                <KeyValue label="Rent billing" value={`${c.billing.state}${c.billing.isLive ? ' (live)' : ''}`} last />
            </Box>
            <Box>
                <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Features</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                    {c.features.map((f) => (
                        <View key={f.key} style={{ marginRight: spacing.xs, marginBottom: spacing.xs }}>
                            <Badge label={f.key} tone={f.on ? 'success' : 'neutral'} />
                        </View>
                    ))}
                </View>
            </Box>

            <SectionTitle section="platform">Server</SectionTitle>
            <Box style={{ paddingVertical: 0 }}>
                <KeyValue label="API" value={i.apiBaseUrl} />
                <KeyValue label="Environment" value={sv.nodeEnv} />
                <KeyValue label="Mock payments" value={yn(sv.paymentsMock)} />
                <KeyValue label="Mock SMS" value={yn(sv.smsMock)} />
                <KeyValue label="Media CDN set" value={yn(sv.mediaCdnSet)} last />
            </Box>

            <SectionTitle section="alerts">Developer notes</SectionTitle>
            <Box>
                <Text style={{ color: t.muted, marginBottom: spacing.sm }}>
                    Your own notes: Play Console account, keystore place, Firebase project, anything you need next time. Only you see this. Do not paste passwords.
                </Text>
                <Field value={notes} onChangeText={setNotes} multiline placeholder="Notes about this shop's app" maxLength={4000} />
                <Button style={{ marginTop: spacing.md }} title="Save notes" loading={saving} onPress={saveNotes} />
            </Box>
        </Screen>
    );
}
