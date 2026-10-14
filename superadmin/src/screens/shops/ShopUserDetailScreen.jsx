import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, KeyValue, Badge, Avatar, ListRow, Stat } from '../../components/ui';
import { Hero, SkeletonList } from '../../components/blocks';
import { Field } from '../../components/inputs';
import { ErrorBox, ConfirmSheet, Sheet, toast } from '../../components/feedback';
import { fetchUser, updateUser, blockUser, revealPhone, changeUserPhone, changeUserRole } from '../../api/shopsApi';
import { allowCod } from '../../api/opsApi';
import { errMsg } from '../../api/adminClient';
import { rupees, dateTime, titleCase } from '../../utils/format';

const ROLES = [
    { value: 'customer', label: 'Customer', hint: 'Orders from the shop', icon: 'user', section: 'people' },
    { value: 'rider', label: 'Rider', hint: 'Delivers orders', icon: 'rider', section: 'riders' },
    { value: 'admin', label: 'Shop owner', hint: 'Runs the shop panel', icon: 'key', section: 'money' },
];
const roleSection = (role) => ROLES.find((r) => r.value === role)?.section || 'people';
const roleLabel = (role) => ROLES.find((r) => r.value === role)?.label || titleCase(role);

export default function ShopUserDetailScreen() {
    const t = useTheme();
    const { shopId, userId, shopName } = useRoute().params;
    const [u, setU] = useState(null);
    const [error, setError] = useState('');
    const [phone, setPhone] = useState(null);     // the revealed full number
    const [sheet, setSheet] = useState(null);     // block | unblock | edit | phone | role
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);
    const [newRole, setNewRole] = useState(null);
    const [refreshing, setRefreshing] = useState(false);

    const load = useCallback(async () => {
        try { setU(await fetchUser(shopId, userId)); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [shopId, userId]);
    useEffect(() => { load(); }, [load]);
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    if (!u) return <Screen title="Person" subtitle={shopName}>{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} />}</Screen>;

    const section = roleSection(u.role);
    const reveal = async () => {
        setBusy(true);
        try { const r = await revealPhone(shopId, userId); setPhone(r.phone); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const saveProfile = async () => {
        setBusy(true);
        try {
            const body = {};
            if ((form.name ?? '') !== (u.name || '')) body.name = form.name ?? '';
            if ((form.email ?? '') !== (u.email || '')) body.email = form.email ?? '';
            if ((form.notes ?? '') !== (u.notes || '')) body.notes = form.notes ?? '';
            if (!Object.keys(body).length) { setSheet(null); return; }
            await updateUser(shopId, userId, body);
            toast('Saved'); setSheet(null); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const savePhone = async () => {
        if (!/^[6-9]\d{9}$/.test(form.phone || '')) { toast('Enter a valid 10-digit number', 'error'); return; }
        if (!(form.reason || '').trim()) { toast('Add a reason', 'error'); return; }
        setBusy(true);
        try {
            await changeUserPhone(shopId, userId, form.phone, form.reason.trim());
            toast('Phone changed. The person is logged out everywhere.'); setSheet(null); setPhone(null); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title={u.name || 'Person'} subtitle={`${roleLabel(u.role)} · ${shopName}`} refreshing={refreshing} onRefresh={refresh}>
            <Hero
                section={u.isBlocked ? 'alerts' : section}
                leading={<Avatar section={u.isBlocked ? 'alerts' : section} name={u.name || u.phone} size={58} />}
                title={u.name || 'No name'}
                subtitle={phone || u.phone}
            >
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <Badge label={roleLabel(u.role)} tone={u.role === 'admin' ? 'primary' : u.role === 'rider' ? 'success' : 'info'} />
                    {u.isBlocked ? <Badge label="Blocked" tone="danger" icon="block" /> : null}
                    {u.cod?.blocked ? <Badge label="COD blocked" tone="warn" /> : null}
                </View>
                {!phone ? (
                    <Button title="Show full number" icon="eye" kind="soft" small onPress={reveal} loading={busy} style={{ marginTop: spacing.lg }} />
                ) : <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>This look was written to the audit log.</Text>}
            </Hero>

            <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                <Stat label="Orders" value={u.stats?.orders ?? 0} icon="orders" section="orders" />
                <Stat label="Delivered" value={u.stats?.delivered ?? 0} icon="ok" section="riders" />
                <Stat label="Spent" value={rupees(u.stats?.spentTotal)} icon="rupee" section="money" />
            </View>

            <SectionTitle section="people">Details</SectionTitle>
            <Card style={{ paddingVertical: 0 }}>
                <KeyValue label="Cancelled orders" value={String(u.stats?.cancelled ?? 0)} />
                <KeyValue label="Last order" value={dateTime(u.stats?.lastOrderAt)} />
                <KeyValue label="Last login" value={dateTime(u.lastLoginAt)} />
                {u.cod ? <KeyValue label="Cash-on-delivery strikes" value={String(u.cod.strikes)} /> : null}
                {u.rider ? <KeyValue label="Rider" value={`${u.rider.isOnline ? 'Online' : 'Offline'} · ★ ${u.rider.ratingAvg ?? '—'}`} /> : null}
                <KeyValue label="Email" value={u.email} />
                <KeyValue label="Notes" value={u.notes} />
                <KeyValue label="Joined" value={dateTime(u.createdAt)} last />
            </Card>

            <SectionTitle section="settings">Manage this person</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="settings" icon="edit" title="Edit profile" subtitle="Name, email, notes" onPress={() => { setForm({ name: u.name || '', email: u.email || '', notes: u.notes || '' }); setSheet('edit'); }} />
                <ListRow section="money" icon="key" title="Change role" subtitle={`Now: ${roleLabel(u.role)}`} onPress={() => setSheet('role')} />
                {u.cod?.blocked ? (
                    <ListRow
                        section="orders"
                        icon="wallet"
                        title="Allow cash on delivery again"
                        subtitle={`Blocked after ${u.cod.strikes} strikes. Strikes go back to 0.`}
                        onPress={async () => { try { await allowCod(shopId, userId); toast('Cash on delivery allowed'); await load(); } catch (e) { toast(errMsg(e), 'error'); } }}
                    />
                ) : null}
                <ListRow section="people" icon="phone" title="Change phone number" subtitle="Logs the person out everywhere" onPress={() => { setForm({ phone: '', reason: '' }); setSheet('phone'); }} />
                <ListRow
                    danger={!u.isBlocked}
                    section={u.isBlocked ? 'money' : 'alerts'}
                    icon={u.isBlocked ? 'ok' : 'block'}
                    title={u.isBlocked ? 'Unblock this person' : 'Block this person'}
                    subtitle={u.isBlocked ? 'They can log in again' : 'Logs them out and stops new logins'}
                    onPress={() => setSheet(u.isBlocked ? 'unblock' : 'block')}
                    last
                />
            </Card>

            <ConfirmSheet
                visible={sheet === 'block'}
                onClose={() => setSheet(null)}
                title="Block this person?"
                message="They are logged out everywhere at once and cannot log in again until you unblock them."
                confirmLabel="Block"
                danger
                onConfirm={async () => {
                    try { await blockUser(shopId, userId, true); toast('Blocked'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
            <ConfirmSheet
                visible={sheet === 'unblock'}
                onClose={() => setSheet(null)}
                title="Unblock this person?"
                confirmLabel="Unblock"
                onConfirm={async () => {
                    try { await blockUser(shopId, userId, false); toast('Unblocked'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />

            <Sheet visible={sheet === 'role'} onClose={() => setSheet(null)} title="Change role">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>
                    The person is logged out so the app opens in the new mode. Not possible while they are blocked or have an order in progress.
                </Text>
                {ROLES.map((r, i) => (
                    <ListRow
                        key={r.value}
                        icon={r.icon}
                        section={r.section}
                        title={r.label + (u.role === r.value ? '  (current)' : '')}
                        subtitle={r.hint}
                        last={i === ROLES.length - 1}
                        onPress={u.role === r.value ? undefined : () => { setSheet(null); setNewRole(r); }}
                    />
                ))}
            </Sheet>

            <ConfirmSheet
                visible={!!newRole}
                onClose={() => setNewRole(null)}
                title={`Make this person a ${newRole?.label?.toLowerCase()}?`}
                message="They are logged out everywhere and sign in again in the new role."
                confirmLabel="Change role"
                onConfirm={async () => {
                    try { await changeUserRole(shopId, userId, newRole.value); toast('Role changed'); setPhone(null); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />

            <Sheet visible={sheet === 'edit'} onClose={() => setSheet(null)} title="Edit profile">
                <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} maxLength={80} />
                <Field label="Email" value={form.email} onChangeText={(v) => setForm({ ...form, email: v })} autoCapitalize="none" keyboardType="email-address" />
                <Field label="Notes" value={form.notes} onChangeText={(v) => setForm({ ...form, notes: v })} multiline maxLength={300} />
                <Button title="Save" onPress={saveProfile} loading={busy} />
            </Sheet>

            <Sheet visible={sheet === 'phone'} onClose={() => setSheet(null)} title="Change phone number">
                <Text style={{ color: t.muted, marginBottom: spacing.lg }}>
                    The person is logged out everywhere. Old and new numbers are kept in the audit log.
                </Text>
                <Field label="New number" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" />
                <Field label="Reason" value={form.reason} onChangeText={(v) => setForm({ ...form, reason: v })} maxLength={200} />
                <Button title="Change number" kind="danger" onPress={savePhone} loading={busy} />
            </Sheet>
        </Screen>
    );
}
