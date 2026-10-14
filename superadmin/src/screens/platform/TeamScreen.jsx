import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Card, Button, Badge, Chip, SectionTitle } from '../../components/ui';
import PersonPhoto from '../../components/PersonPhoto';
import { Field } from '../../components/inputs';
import { Loading, Empty, ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { fetchTeam, addSuperadmin, revokeSuperadmin, restoreSuperadmin } from '../../api/teamApi';
import { errMsg } from '../../api/adminClient';
import { useShopsStore } from '../../store/useShopsStore';
import { ago } from '../../utils/format';

const PHONE_RE = /^[6-9]\d{9}$/;
const SHOP_ROLES = [
    { value: 'customer', label: 'Customer' },
    { value: 'rider', label: 'Rider' },
    { value: 'admin', label: 'Shop owner' },
];

// The people who can run the platform. Rules (also enforced by the server):
//   - you cannot revoke yourself, another superadmin has to
//   - a revoked superadmin is logged out at once and can be restored
//   - when revoking, the person can be made a customer, rider or owner of one shop
export default function TeamScreen() {
    const t = useTheme();
    const [items, setItems] = useState(null);
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ name: '', phone: '', phone2: '' });
    const [busy, setBusy] = useState(false);
    const [target, setTarget] = useState(null);        // the superadmin being revoked
    const [mode, setMode] = useState('plain');         // plain | shop
    const [shopId, setShopId] = useState('');
    const [role, setRole] = useState('customer');
    const [restoring, setRestoring] = useState(null);
    const shops = useShopsStore((s) => s.items);

    const load = useCallback(async () => {
        try { setItems((await fetchTeam()).items); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (target && !shops.length) useShopsStore.getState().load(); }, [target, shops.length]);

    const add = async () => {
        const phones = [form.phone, form.phone2].filter(Boolean);
        if (!phones.length || !phones.every((p) => PHONE_RE.test(p))) { toast('Enter valid 10-digit mobile numbers', 'error'); return; }
        setBusy(true);
        try {
            await addSuperadmin({ name: form.name.trim() || undefined, phones });
            toast('Superadmin added'); setAdding(false); setForm({ name: '', phone: '', phone2: '' }); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const startRevoke = (a) => { setTarget(a); setMode('plain'); setShopId(''); setRole('customer'); };
    const revoke = async () => {
        if (mode === 'shop' && !shopId) { toast('Pick a shop', 'error'); return; }
        setBusy(true);
        try {
            const r = await revokeSuperadmin(target.id, mode === 'shop' ? { tenantId: shopId, role } : {});
            toast(r.shopRole ? `Access revoked. Now ${SHOP_ROLES.find((x) => x.value === r.shopRole.role)?.label} of ${r.shopRole.shop}` : 'Access revoked');
            setTarget(null); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Superadmin team" subtitle="Who can run the platform" right={<HeaderButton icon="userAdd" onPress={() => setAdding(true)} />}>
            {items === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <Loading />) : !items.length ? (
                <Empty icon="crown" title="No superadmins" />
            ) : items.map((a) => (
                <Card key={String(a.id)} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <PersonPhoto uri={a.photo} name={a.name || a.phones?.[0]} section={a.isActive ? 'shops' : 'alerts'} size={50} />
                        <View style={{ flex: 1, marginLeft: spacing.md }}>
                            <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800' }} numberOfLines={1}>{a.name || 'Superadmin'}{a.isMe ? '  (you)' : ''}</Text>
                            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }} numberOfLines={1}>{(a.phones || []).join(' · ')}</Text>
                        </View>
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, flexWrap: 'wrap' }}>
                        <Badge label={a.isActive ? 'Active' : 'Revoked'} tone={a.isActive ? 'success' : 'danger'} />
                        <Badge label={`Last login ${ago(a.lastLoginAt)}`} />
                    </View>
                    {a.isMe ? (
                        <Text style={{ color: t.muted, fontSize: font.xs, marginTop: spacing.md }}>You cannot change your own role. Another superadmin has to do it.</Text>
                    ) : a.isActive ? (
                        <Button title="Revoke access" kind="dangerSoft" small style={{ marginTop: spacing.md }} onPress={() => startRevoke(a)} />
                    ) : (
                        <Button title="Restore access" kind="soft" small style={{ marginTop: spacing.md }} onPress={() => setRestoring(a)} />
                    )}
                </Card>
            ))}

            <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a superadmin">
                <Text style={{ color: t.muted, marginBottom: spacing.lg }}>
                    They log in to Retail Control with this number and an OTP. They get full platform access.
                </Text>
                <Field label="Name" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} maxLength={80} />
                <Field label="Mobile number" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" />
                <Field label="Second number (optional)" value={form.phone2} onChangeText={(v) => setForm({ ...form, phone2: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" />
                <Button title="Add superadmin" onPress={add} loading={busy} />
            </Sheet>

            <Sheet visible={!!target} onClose={() => !busy && setTarget(null)} title={`Revoke ${target?.name || 'superadmin'}?`}>
                <Text style={{ color: t.muted, marginBottom: spacing.lg }}>
                    They are logged out at once and lose all platform access. You can restore it later.
                </Text>
                <View style={{ flexDirection: 'row', marginBottom: spacing.md }}>
                    <Chip label="Just revoke" active={mode === 'plain'} onPress={() => setMode('plain')} />
                    <Chip label="Also give a shop role" active={mode === 'shop'} onPress={() => setMode('shop')} />
                </View>
                {mode === 'shop' ? (
                    <>
                        <Text style={{ color: t.text, fontWeight: '700', marginBottom: 8 }}>Role</Text>
                        <View style={{ flexDirection: 'row', marginBottom: spacing.md }}>
                            {SHOP_ROLES.map((r) => <Chip key={r.value} label={r.label} active={role === r.value} onPress={() => setRole(r.value)} />)}
                        </View>
                        <Text style={{ color: t.text, fontWeight: '700', marginBottom: 8 }}>In which shop</Text>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.lg }}>
                            {shops.map((s) => <Chip key={s._id} label={s.name} active={shopId === s._id} onPress={() => setShopId(s._id)} />)}
                        </ScrollView>
                    </>
                ) : null}
                <Button title="Revoke access" kind="danger" onPress={revoke} loading={busy} />
                <Button title="Cancel" kind="outline" onPress={() => setTarget(null)} disabled={busy} style={{ marginTop: spacing.sm }} />
            </Sheet>

            <ConfirmSheet
                visible={!!restoring}
                onClose={() => setRestoring(null)}
                title="Restore access?"
                message={`${restoring?.name || 'This person'} can log in as a superadmin again.`}
                confirmLabel="Restore"
                onConfirm={async () => {
                    try { await restoreSuperadmin(restoring.id); toast('Access restored'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; }
                }}
            />
        </Screen>
    );
}
