import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge, SectionTitle, Chip } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import MovePersonSheet from './MovePersonSheet';
import BrandPlanCard from './BrandPlanCard';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchBrand, addBranch, removeBranch, updateBrand, addBrandOwner, removeBrandOwner, fetchBrandSettings, setAreaLock } from '../../api/brandsApi';
import { errMsg } from '../../api/adminClient';
import { fetchShops, closeShop } from '../../api/shopsApi';
import { pushBrandSettings } from '../../api/brandsApi';

// the settings groups "Apply to all branches" can copy (never the map pin, the keys or what an owner switches by hand)
const GROUPS = [['hours', 'Opening hours'], ['orders', 'Orders and fees'], ['features', 'App features'], ['menu', 'Menu and offers display'], ['riders', 'Riders and delivery'], ['home', 'Home layout'], ['brand', 'Brand and look'], ['notifications', 'Alerts and reports'], ['app', 'App version']];

const STEPS = [['location', 'Pin and radius set'], ['keys', 'Razorpay keys set'], ['owner', 'Owner or manager added'], ['live', 'Live']];
const blank = { name: '', slug: '', city: '', managerPhone: '' };

// One brand: its branches, each with the go-live checklist, and the form to add a branch.
export default function BrandDetailScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const supreme = useSupreme();
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [add, setAdd] = useState(false);
    const [moveOpen, setMoveOpen] = useState(false);
    // attach a shop that already exists
    const [att, setAtt] = useState(false);
    const [q, setQ] = useState('');
    const [found, setFound] = useState(null);         // shops matching the search (null while loading)
    const [chosen, setChosen] = useState(null);       // the shop picked
    const [acity, setAcity] = useState('');
    useEffect(() => {
        if (!att || chosen) return undefined;
        setFound(null);
        const h = setTimeout(() => { fetchShops(q.trim() || undefined).then((x) => setFound((x.items || []).filter((s) => !s.brandId))).catch((e) => { setFound([]); toast(errMsg(e), 'error'); }); }, 300);
        return () => clearTimeout(h);
    }, [att, q, chosen]);
    const attach = async () => {
        setBusy(true);
        try {
            const x = await addBranch(id, { tenantId: chosen._id || chosen.id, city: acity.trim() });
            toast(x.problems && x.problems.length ? `Attached. Check: ${x.problems.join(' ')}` : 'Shop attached as a branch');
            setAtt(false); setChosen(null); setQ(''); setAcity(''); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const [f, setF] = useState(blank);
    const [copy, setCopy] = useState(true);
    // apply a branch's settings to the others
    const [applyOpen, setApplyOpen] = useState(false);
    const [applyFrom, setApplyFrom] = useState(null);
    const [applyWhat, setApplyWhat] = useState([]);
    // close every open branch
    const [closeAll, setCloseAll] = useState(false);
    const [out, setOut] = useState(null);
    const [busy, setBusy] = useState(false);
    const [cfg, setCfg] = useState(null);
    const [ownerOpen, setOwnerOpen] = useState(false);
    const [ownerPhone, setOwnerPhone] = useState('');
    const [dropOwner, setDropOwner] = useState(null);

    const load = useCallback(async () => {
        setErr('');
        try { setR(await fetchBrand(id)); } catch (e) { setErr(errMsg(e)); }
        fetchBrandSettings().then(setCfg).catch(() => { });
    }, [id]);
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
    const doApply = async () => {
        setBusy(true);
        try {
            const to = r.branches.filter((b) => b.id !== applyFrom).map((b) => b.id);
            const x = await pushBrandSettings(id, { fromTenantId: applyFrom, toTenantIds: to, sections: applyWhat });
            toast(`Copied to ${x.applied.length} branch${x.applied.length === 1 ? '' : 'es'}`); setApplyOpen(false);
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
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
    const toggleLock = async (b) => {
        try { await setAreaLock(id, b.id, !b.area.locked); toast(b.area.locked ? 'Pin and radius unlocked' : 'Pin and radius locked'); load(); } catch (e) { toast(errMsg(e), 'error'); }
    };
    const takeOut = async () => {
        try { await removeBranch(id, out.id); toast('Taken out of the brand'); setOut(null); load(); } catch (e) { toast(errMsg(e), 'error'); setOut(null); }
    };

    return (
        <Screen title={r.brand.name} subtitle={`${r.branches.length} branch${r.branches.length === 1 ? '' : 'es'} · ${(r.brand.ownerPhones || []).length} owner${(r.brand.ownerPhones || []).length === 1 ? '' : 's'}`} onRefresh={load}>
            {r.branches.length ? (
                <Card style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <View><Text style={{ color: t.muted, fontSize: font.sm }}>Orders today</Text><Text style={{ color: t.text, fontSize: font.xl, fontWeight: '800' }}>{r.branches.reduce((a, b) => a + (b.ordersToday || 0), 0)}</Text></View>
                    </View>
                </Card>
            ) : <Card><Text style={{ color: t.muted }}>No branches yet. Add the first one below.</Text></Card>}
            <BrandPlanCard brandId={id} plan={r.plan} canEdit={supreme} onChanged={load} />
            <SectionTitle section="shops">Branches</SectionTitle>
            {r.branches.map((b) => (
                <Card key={b.id} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }}>{b.name}</Text>
                        {b.closed ? <Badge label="Closed" tone="danger" icon="lock" /> : <Badge label={b.checklist.live ? 'Live' : b.checklist.ready ? 'Ready to go live' : 'Setting up'} tone={b.checklist.live ? 'success' : b.checklist.ready ? 'info' : 'warn'} />}
                    </View>
                    <Text style={{ color: t.muted, marginTop: 2 }}>{b.city || 'City not set'} · {b.ordersToday} today · {b.ordersThisMonth} this month</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                        <Chip label="Open shop" icon="shops" onPress={() => nav.navigate('ShopDetail', { shopId: b.id, name: b.name })} />
                        {supreme ? <Chip label={b.closed ? 'Opening options' : 'Close this branch'} icon="lock" onPress={() => nav.navigate('ShopClose', { shopId: b.id, name: b.name })} /> : null}
                    </View>
                    <View style={{ marginTop: spacing.sm }}>
                        {STEPS.map(([k, label]) => (
                            <Text key={k} style={{ color: b.checklist[k] ? t.success : t.muted, marginTop: 2 }}>{b.checklist[k] ? '✓' : '○'}  {label}</Text>
                        ))}
                        {b.area ? <Text style={{ color: b.area.locked ? t.warn : t.muted, marginTop: 4, fontSize: font.sm }}>{`${b.area.by ? `Pin and radius last changed by ${b.area.by.who} (${b.area.by.role}) on ${new Date(b.area.by.at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Pin and radius not set yet'}${b.area.locked ? ' · LOCKED: only you, a superadmin or the brand owner can change them' : ''}`}</Text> : null}
                        {b.razorpayKeyId ? <Text style={{ color: t.muted, marginTop: 4, fontSize: font.sm }}>Pays to Razorpay key {b.razorpayKeyId}</Text> : null}
                    </View>
                    {supreme && b.area ? <Button title={b.area.locked ? 'Unlock pin and radius' : 'Lock pin and radius'} kind="outline" small style={{ marginTop: spacing.md }} onPress={() => toggleLock(b)} /> : null}
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
                {r.branches.length > 1 ? <Button title="Move a person between branches" icon="next" kind="outline" small style={{ marginTop: spacing.md }} onPress={() => setMoveOpen(true)} /> : null}
                <Button title="Add a brand owner" icon="add" small disabled={(r.brand.ownerPhones || []).length >= 3} style={{ marginTop: spacing.md }} onPress={() => setOwnerOpen(true)} />
            </Card>
            {supreme ? (
                <>
                    <SectionTitle section="platform">Manage</SectionTitle>
                    <Button title="Add a branch" icon="add" onPress={() => setAdd(true)} />
                    <Button title="Add an existing shop" icon="shops" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => { setChosen(null); setQ(''); setAcity(''); setAtt(true); }} />
                    {r.branches.length > 1 ? <Button title="Apply one branch's settings to the others" icon="tune" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => { setApplyFrom(r.branches[0].id); setApplyWhat([]); setApplyOpen(true); }} /> : null}
                    {r.branches.some((b) => !b.closed) ? <Button title="Close every open branch" icon="lock" kind="dangerSoft" style={{ marginTop: spacing.sm }} onPress={() => setCloseAll(true)} /> : null}
                </>
            ) : null}

            <Sheet visible={att} onClose={() => setAtt(false)} title="Add an existing shop">
                {!chosen ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Pick a shop that is not part of any brand yet. It keeps its menu, orders and settings and becomes a branch of this brand.</Text>
                        <Field label="Search by name or short name" placeholder="e.g. Savera Hyderabad" hint="Type part of the shop's name to find it." value={q} onChangeText={setQ} autoCapitalize="none" maxLength={40} />
                        {found === null ? <SkeletonList /> : null}
                        {found && !found.length ? <Text style={{ color: t.muted }}>No free shop found. A shop already in a brand cannot be taken from there.</Text> : null}
                        {found ? found.slice(0, 20).map((sh) => (
                            <Button key={sh._id || sh.id} title={`${sh.name} (${sh.slug})`} kind="outline" small style={{ marginBottom: spacing.sm }} onPress={() => { setChosen(sh); setAcity(''); }} />
                        )) : null}
                    </>
                ) : (
                    <>
                        <Text style={{ color: t.text, fontWeight: '800', marginBottom: spacing.sm }}>{`${chosen.name} (${chosen.slug})`}</Text>
                        <Text style={{ color: t.muted, marginBottom: spacing.md }}>It becomes a branch of {r && r.brand ? r.brand.name : 'this brand'}. Its own SMS balance moves into the brand's shared SMS wallet, and the brand owners get access to it. Its staff must not also work at another branch of this brand.</Text>
                        <Field label="City of this branch" placeholder="e.g. Hyderabad" hint="Shown to customers when they choose a branch." value={acity} onChangeText={setAcity} maxLength={60} />
                        <Button title="Attach this shop" loading={busy} disabled={!acity.trim()} onPress={attach} />
                        <Button title="Choose another shop" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => setChosen(null)} />
                    </>
                )}
            </Sheet>

            <Sheet visible={add} onClose={() => setAdd(false)} title="Add a branch">
                <Field label="Branch name" placeholder="e.g. Savera Hyderabad" hint="The name of this branch shop." value={f.name} onChangeText={set('name')} maxLength={80} />
                <Field label="Short name for the link (letters, numbers, hyphen)" placeholder="e.g. savera-hyderabad" hint="This branch's short code in its address. Letters, numbers and hyphens only." value={f.slug} onChangeText={(v) => set('slug')(v.toLowerCase().replace(/[^a-z0-9-]/g, ''))} autoCapitalize="none" maxLength={40} />
                <Field label="City" placeholder="e.g. Kanpur" hint="Shown with the address in the customer app." value={f.city} onChangeText={set('city')} maxLength={60} />
                <Field label="Manager phone (optional)" placeholder="10 digits, e.g. 9876543210" hint="A manager who runs this branch day to day. Can stay empty." value={f.managerPhone} onChangeText={(v) => set('managerPhone')(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                {first ? <Button title={`${copy ? '✓ ' : ''}Start from the look, rules and menu of ${first.name}`} kind={copy ? 'soft' : 'outline'} small onPress={() => setCopy(!copy)} style={{ marginBottom: spacing.md }} /> : null}
                <Button title="Add branch" loading={busy} disabled={f.name.trim().length < 2 || f.slug.length < 3 || !f.city.trim()} onPress={create} />
            </Sheet>

            <Sheet visible={applyOpen} onClose={() => setApplyOpen(false)} title="Apply settings to the other branches">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>Copy chosen settings from one branch onto every other branch. Their map pin and delivery area, payment keys, menu, owners and bills are never touched, and neither is what an owner switches by hand (accepting orders, pause).</Text>
                <Text style={{ color: t.text, fontWeight: '800', marginBottom: 6 }}>Copy from</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
                    {r.branches.map((b) => <Chip key={b.id} label={b.name} active={applyFrom === b.id} onPress={() => setApplyFrom(b.id)} />)}
                </View>
                <Text style={{ color: t.text, fontWeight: '800', marginBottom: 6 }}>What to copy</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.md }}>
                    {GROUPS.map(([k, label]) => <Chip key={k} label={label} active={applyWhat.includes(k)} onPress={() => setApplyWhat((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]))} />)}
                </View>
                <Button title={`Copy to ${r.branches.length - 1} other branch${r.branches.length - 1 === 1 ? '' : 'es'}`} loading={busy} disabled={!applyFrom || !applyWhat.length} onPress={doApply} />
            </Sheet>

            <ConfirmSheet
                visible={closeAll}
                onClose={() => setCloseAll(false)}
                icon="lock"
                danger
                title={`Close every open branch of ${r.brand.name}?`}
                message="Each open branch stops taking new orders and closes when its orders in progress are done. Nothing is deleted. You can open each one again."
                needReason
                reasonLabel="Reason (kept in your records, never shown to owners or customers)"
                confirmLabel="Close all"
                onConfirm={async (why) => { const list = r.branches.filter((x) => !x.closed); let done = 0; for (const b of list) { try { await closeShop(b.id, { reason: why, kind: 'manual', orders: 'finish' }); done += 1; } catch (e) { toast(`${b.name}: ${errMsg(e)}`, 'error'); } } toast(`${done} branch${done === 1 ? '' : 'es'} closed`); load(); }}
            />

            <Sheet visible={ownerOpen} onClose={() => setOwnerOpen(false)} title="Add a brand owner">
                <Field label="Mobile number" placeholder="10 digits, e.g. 9876543210" hint="A brand owner logs in with this number and can open every branch." value={ownerPhone} onChangeText={(v) => setOwnerPhone(v.replace(/\D/g, '').slice(0, 10))} keyboardType="number-pad" />
                <Button title="Add" loading={busy} disabled={ownerPhone.length !== 10} onPress={saveOwner} />
            </Sheet>

            <ConfirmSheet visible={!!dropOwner} onClose={() => setDropOwner(null)} title="Remove this brand owner?" message="They lose the owner panel in every branch of this brand. Nothing is deleted." confirmLabel="Remove" onConfirm={dropOwnerNow} />

            <ConfirmSheet visible={!!out} onClose={() => setOut(null)} title="Take this branch out?" message={`${out ? out.name : ''} stays a normal shop. Nothing is deleted.`} confirmLabel="Take out" onConfirm={takeOut} />
            <MovePersonSheet visible={moveOpen} onClose={() => setMoveOpen(false)} brandId={id} branches={r.branches} onDone={load} />
        </Screen>
    );
}
