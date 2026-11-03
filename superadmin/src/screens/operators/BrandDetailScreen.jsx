import React, { useCallback, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, SectionTitle } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchBrand, addBranch, removeBranch, updateBrand, addBrandOwner, removeBrandOwner } from '../../api/brandsApi';
import { errMsg } from '../../api/adminClient';

const STEPS = [['location', 'Pin and radius set'], ['keys', 'Razorpay keys set'], ['owner', 'Owner or manager added'], ['live', 'Live']];
const blank = { name: '', slug: '', city: '', managerPhone: '' };

// One brand: its branches, each with the go-live checklist, and the form to add a branch.
export default function BrandDetailScreen() {
    const t = useTheme();
    const { id } = useRoute().params || {};
    const supreme = useSupreme();
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [add, setAdd] = useState(false);
    const [f, setF] = useState(blank);
    const [copy, setCopy] = useState(true);
    const [limit, setLimit] = useState('');
    const [limitOpen, setLimitOpen] = useState(false);
    const [out, setOut] = useState(null);
    const [busy, setBusy] = useState(false);
    const [ownerOpen, setOwnerOpen] = useState(false);
    const [ownerPhone, setOwnerPhone] = useState('');
    const [dropOwner, setDropOwner] = useState(null);

    const load = useCallback(async () => { setErr(''); try { setR(await fetchBrand(id)); } catch (e) { setErr(errMsg(e)); } }, [id]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    if (!r) return <Screen title="Brand">{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const first = r.branches[0];

    const create = async () => {
        setBusy(true);
        try {
            await addBranch(id, {
                name: f.name.trim(), slug: f.slug.trim().toLowerCase(), city: f.city.trim(),
                ...(f.managerPhone ? { managerPhone: f.managerPhone } : {}),
                ...(copy && first ? { copyFromTenantId: first.id } : {}),
            });
            toast('Branch added'); setAdd(false); setF(blank); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const saveLimit = async () => {
        setBusy(true);
        try { await updateBrand(id, { branchLimit: Number(limit) }); toast('Saved'); setLimitOpen(false); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const saveOwner = async () => {
        setBusy(true);
        try {
            const x = await addBrandOwner(id, ownerPhone);
            toast(x.problems && x.problems.length ? `Added, but: ${x.problems[0]}` : 'Brand owner added');
            setOwnerOpen(false); setOwnerPhone(''); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const dropOwnerNow = async () => {
        try { await removeBrandOwner(id, dropOwner); toast('Brand owner removed'); } catch (e) { toast(errMsg(e), 'error'); }
        setDropOwner(null); load();
    };
    const takeOut = async () => {
        try { await removeBranch(id, out.id); toast('Taken out of the brand'); setOut(null); load(); } catch (e) { toast(errMsg(e), 'error'); setOut(null); }
    };

    return (
        <Screen title={r.brand.name} subtitle={`${r.branches.length} of ${r.brand.branchLimit} branches`} onRefresh={load}>
            {!r.branches.length ? <Card><Text style={{ color: t.muted }}>No branches yet. Add the first one below.</Text></Card> : null}
            {r.branches.map((b) => (
                <Card key={b.id} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }}>{b.name}</Text>
                        <Badge label={b.checklist.live ? 'Live' : b.checklist.ready ? 'Ready to go live' : 'Setting up'} tone={b.checklist.live ? 'success' : b.checklist.ready ? 'info' : 'warn'} />
                    </View>
                    <Text style={{ color: t.muted, marginTop: 2 }}>{b.city || 'City not set'} · {b.ordersThisMonth} orders this month</Text>
                    <View style={{ marginTop: spacing.sm }}>
                        {STEPS.map(([k, label]) => (
                            <Text key={k} style={{ color: b.checklist[k] ? t.success : t.muted, marginTop: 2 }}>{b.checklist[k] ? '✓' : '○'}  {label}</Text>
                        ))}
                        {b.razorpayKeyId ? <Text style={{ color: t.muted, marginTop: 4, fontSize: font.sm }}>Pays to Razorpay key {b.razorpayKeyId}</Text> : null}
                    </View>
                    {supreme ? <Button title="Take out of brand" kind="outline" small style={{ marginTop: spacing.md }} onPress={() => setOut(b)} /> : null}
                </Card>
            ))}
            <SectionTitle section="platform">Brand owners</SectionTitle>
            <Card style={{ marginBottom: spacing.md }}>
                <Text style={{ color: t.muted }}>A brand owner is owner of every branch and can switch between them in the owner app.</Text>
                {(r.brand.ownerPhones || []).map((p) => (
                    <View key={p} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm }}>
                        <Text style={{ color: t.text, fontWeight: '700' }}>{p}</Text>
                        <Button title="Remove" kind="outline" small onPress={() => setDropOwner(p)} />
                    </View>
                ))}
                <Button title="Add a brand owner" icon="add" small disabled={(r.brand.ownerPhones || []).length >= 3} style={{ marginTop: spacing.md }} onPress={() => setOwnerOpen(true)} />
            </Card>
            {supreme ? (
                <>
                    <SectionTitle section="platform">Manage</SectionTitle>
                    <Button title="Add a branch" icon="add" disabled={!r.canAdd} onPress={() => setAdd(true)} />
                    {!r.canAdd ? <Text style={{ color: t.muted, marginTop: 6 }}>The limit is reached. Raise it to add more.</Text> : null}
                    <Button title="Change branch limit" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => { setLimit(String(r.brand.branchLimit)); setLimitOpen(true); }} />
                </>
            ) : null}

            <Sheet visible={add} onClose={() => setAdd(false)} title="Add a branch">
                <Field label="Branch name" value={f.name} onChangeText={set('name')} maxLength={80} />
                <Field label="Short name for the link (letters, numbers, hyphen)" value={f.slug} onChangeText={(v) => set('slug')(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} autoCapitalize="none" maxLength={40} />
                <Field label="City" value={f.city} onChangeText={set('city')} maxLength={60} />
                <Field label="Manager phone (optional)" value={f.managerPhone} onChangeText={(v) => set('managerPhone')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                {first ? <Button title={`${copy ? '✓ ' : ''}Start from the look, rules and menu of ${first.name}`} kind={copy ? 'soft' : 'outline'} small onPress={() => setCopy(!copy)} style={{ marginBottom: spacing.md }} /> : null}
                <Button title="Add branch" loading={busy} disabled={f.name.trim().length < 2 || f.slug.length < 3 || !f.city.trim()} onPress={create} />
            </Sheet>

            <Sheet visible={limitOpen} onClose={() => setLimitOpen(false)} title="Branch limit">
                <Field label="Most branches allowed" value={limit} onChangeText={(v) => setLimit(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" />
                <Button title="Save" loading={busy} disabled={!limit} onPress={saveLimit} />
            </Sheet>

            <Sheet visible={ownerOpen} onClose={() => setOwnerOpen(false)} title="Add a brand owner">
                <Field label="Mobile number" value={ownerPhone} onChangeText={(v) => setOwnerPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                <Button title="Add" loading={busy} disabled={ownerPhone.length !== 10} onPress={saveOwner} />
            </Sheet>

            <ConfirmSheet visible={!!dropOwner} onClose={() => setDropOwner(null)} title="Remove this brand owner?" message="They lose the owner panel in every branch of this brand. Nothing is deleted." confirmLabel="Remove" onConfirm={dropOwnerNow} />

            <ConfirmSheet visible={!!out} onClose={() => setOut(null)} title="Take this branch out?" message={`${out ? out.name : ''} stays a normal shop. Nothing is deleted.`} confirmLabel="Take out" onConfirm={takeOut} />
        </Screen>
    );
}
