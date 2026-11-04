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
import { useSupreme } from '../../hooks/useSupreme';
import { fetchBrand, addBranch, removeBranch, updateBrand, addBrandOwner, removeBrandOwner, fetchBrandSettings, fetchBrandStatement, setAreaLock, shareBrandStatementPdf, setFreeStart, bulkWaiveLateFees, bulkMarkPaid, bulkMarkUnpaid } from '../../api/brandsApi';
import { errMsg } from '../../api/adminClient';
import { fetchShops, closeShop } from '../../api/shopsApi';
import { remindShop, remindBrand } from '../../api/insightsApi';
import { pushBrandSettings } from '../../api/brandsApi';
import { rupees } from '../../utils/format';

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
    const [stmt, setStmt] = useState(null);
    const [cfg, setCfg] = useState(null);
    // bulk money actions (supreme admin): which branches, which action, the answers, the result
    const [pick, setPick] = useState('all');          // 'all' or a list of branch ids
    const [bulk, setBulk] = useState(null);           // 'waive' | 'paid' | 'unpaid'
    const [reason, setReason] = useState('');
    const [mode, setMode] = useState('upi');
    const [receiver, setReceiver] = useState('owner');
    const [ref, setRef] = useState('');
    const [bnote, setBnote] = useState('');
    const [month, setMonth] = useState('');
    const [result, setResult] = useState(null);
    const [freeOpen, setFreeOpen] = useState(false);
    const [freeOrders, setFreeOrders] = useState('');
    const [freeMonths, setFreeMonths] = useState('');
    const [discOpen, setDiscOpen] = useState(false);
    const [disc, setDisc] = useState('');
    const [ownerOpen, setOwnerOpen] = useState(false);
    const [ownerPhone, setOwnerPhone] = useState('');
    const [dropOwner, setDropOwner] = useState(null);

    const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const load = useCallback(async () => {
        setErr('');
        try { setR(await fetchBrand(id)); } catch (e) { setErr(errMsg(e)); }
        fetchBrandStatement(id, lastMonth()).then(setStmt).catch(() => setStmt(null));
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
    const remindOne = async (b) => {
        try { const x = await remindShop(b.id); toast(`Reminder sent to ${x.shopName}: ₹${x.amount} for ${x.month}`); load(); } catch (e) { toast(errMsg(e), 'error'); }
    };
    const remindAll = async () => {
        setBusy(true);
        try { const x = await remindBrand(id); toast(x.sent.length ? `Reminded ${x.sent.length} branch${x.sent.length === 1 ? '' : 'es'}${x.skipped.length ? ` (${x.skipped.length} reminded recently or nothing due)` : ''}` : 'Nobody to remind: nothing is due, or they were reminded in the last hour'); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const doApply = async () => {
        setBusy(true);
        try {
            const to = r.branches.filter((b) => b.id !== applyFrom).map((b) => b.id);
            const x = await pushBrandSettings(id, { fromTenantId: applyFrom, toTenantIds: to, sections: applyWhat });
            toast(`Copied to ${x.applied.length} branch${x.applied.length === 1 ? '' : 'es'}`); setApplyOpen(false);
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const saveDisc = async () => {
        setBusy(true);
        try { await updateBrand(id, { discountPercent: Number(disc) || 0 }); toast('Saved'); setDiscOpen(false); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
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
    const sharePdf = async () => {
        setBusy(true);
        try { await shareBrandStatementPdf(r.brand, stmt.period); } catch (e) { toast(e.safe ? e.message : errMsg(e, 'Could not get the PDF'), 'error'); } finally { setBusy(false); }
    };
    const saveFree = async (on) => {
        setBusy(true);
        try {
            await setFreeStart(id, { on, ...(on && freeOrders !== '' ? { freeOrders: Number(freeOrders) } : {}), ...(on && freeMonths !== '' ? { freeMonths: Number(freeMonths) } : {}) });
            toast(on ? 'Free start is on' : 'Free start ended'); setFreeOpen(false); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const togglePick = (bid) => setPick((cur) => {
        const list = cur === 'all' ? r.branches.map((b) => b.id) : cur;
        const next = list.includes(bid) ? list.filter((x) => x !== bid) : [...list, bid];
        return next.length === r.branches.length ? 'all' : next;
    });
    const pickedNames = pick === 'all' ? 'All branches' : r.branches.filter((b) => pick.includes(b.id)).map((b) => b.name).join(', ');
    const runBulk = async () => {
        setBusy(true);
        try {
            const out = bulk === 'waive' ? await bulkWaiveLateFees(id, pick, reason.trim())
                : bulk === 'paid' ? await bulkMarkPaid(id, { tenantIds: pick, paymentMode: mode, receivedBy: receiver, ...(ref.trim() ? { paymentRef: ref.trim() } : {}), ...(bnote.trim() ? { note: bnote.trim() } : {}) })
                    : await bulkMarkUnpaid(id, { tenantIds: pick, period: month.trim() });
            setBulk(null); setResult({ action: bulk, ...out }); load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
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
                        <View style={{ alignItems: 'flex-end' }}><Text style={{ color: t.muted, fontSize: font.sm }}>Rent due, all branches</Text><Text style={{ color: r.branches.some((b) => b.overdue > 0) ? t.danger : t.text, fontSize: font.xl, fontWeight: '800' }}>{rupees(r.branches.reduce((a, b) => a + (b.owed || 0), 0))}</Text></View>
                    </View>
                    {supreme && r.branches.some((b) => b.owed > 0) ? <Button small kind="soft" icon="bell" title="Remind every branch that owes" loading={busy} onPress={remindAll} style={{ marginTop: spacing.md }} /> : null}
                </Card>
            ) : <Card><Text style={{ color: t.muted }}>No branches yet. Add the first one below.</Text></Card>}
            <SectionTitle section="shops">Branches</SectionTitle>
            {r.branches.map((b) => (
                <Card key={b.id} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }}>{b.name}</Text>
                        {b.closed ? <Badge label="Closed" tone="danger" icon="lock" /> : <Badge label={b.checklist.live ? 'Live' : b.checklist.ready ? 'Ready to go live' : 'Setting up'} tone={b.checklist.live ? 'success' : b.checklist.ready ? 'info' : 'warn'} />}
                    </View>
                    <Text style={{ color: t.muted, marginTop: 2 }}>{b.city || 'City not set'} · {b.ordersToday} today · {b.ordersThisMonth} this month</Text>
                    {b.owed > 0 ? <Text style={{ color: b.overdue > 0 ? t.danger : t.muted, fontWeight: '800', marginTop: 4 }}>Rent due {rupees(b.owed)}{b.overdue > 0 ? ` (${rupees(b.overdue)} overdue)` : ''}</Text> : <Text style={{ color: t.muted, marginTop: 4 }}>Rent: all paid</Text>}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm }}>
                        <Chip label="Open shop" icon="shops" onPress={() => nav.navigate('ShopDetail', { shopId: b.id, name: b.name })} />
                        {supreme && b.owed > 0 ? <Chip label="Remind to pay" icon="bell" onPress={() => remindOne(b)} /> : null}
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
            {stmt ? (
                <>
                    <SectionTitle section="money">{`Statement for ${stmt.period}`}</SectionTitle>
                    <Card style={{ marginBottom: spacing.md }}>
                        {stmt.totals.invoices ? (
                            <>
                                <Text style={{ color: t.text, fontWeight: '800' }}>{`Total ₹${stmt.totals.total} for ${stmt.totals.invoices} branch bills`}</Text>
                                <Text style={{ color: t.muted, marginTop: 2 }}>{`Rent ₹${stmt.totals.rent}, multi-branch discount −₹${stmt.totals.discount}, GST ₹${stmt.totals.gst}`}</Text>
                                <Text style={{ color: stmt.totals.unpaidCount ? t.warn : t.success, marginTop: 2 }}>{stmt.totals.unpaidCount ? `Unpaid: ₹${stmt.totals.unpaid} (${stmt.totals.unpaidCount} bills)` : 'All paid'}</Text>
                            </>
                        ) : <Text style={{ color: t.muted }}>No branch bill for this month.</Text>}
                        {stmt.branches.map((b) => (
                            <Text key={b.slug} style={{ color: t.muted, marginTop: spacing.xs }}>{`${b.name}: ${b.invoice ? `₹${b.invoice.total} · ${b.invoice.status}` : 'no bill'} · about ${b.sms.count} SMS`}</Text>
                        ))}
                        {stmt.totals.invoices ? <Button title="Share the statement PDF" kind="outline" small loading={busy} style={{ marginTop: spacing.md }} onPress={sharePdf} /> : null}
                        {stmt.smsWallet ? <Text style={{ color: stmt.smsWallet.low ? t.warn : t.muted, marginTop: spacing.sm }}>{`One SMS wallet for all branches: ₹${(stmt.smsWallet.balancePaise / 100).toFixed(2)}`}</Text> : null}
                    </Card>
                </>
            ) : null}
            {r.freeStart ? (
                <>
                    <SectionTitle section="money">Free start</SectionTitle>
                    <Card style={{ marginBottom: spacing.md }}>
                        <Text style={{ color: t.text, fontWeight: '800' }}>
                            {r.freeStart.ended ? 'The shared free start has ended' : r.freeStart.on ? 'New branches share one free start' : 'New branches get no free start'}
                        </Text>
                        <Text style={{ color: t.muted, marginTop: 2 }}>
                            {r.freeStart.on && !r.freeStart.ended
                                ? `${r.freeStart.ordersSoFar} of ${r.freeStart.freeOrders} orders used${r.freeStart.startedAt ? ` · started ${new Date(r.freeStart.startedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : ' · starts when the first branch goes live'} · ends at ${r.freeStart.freeOrders} orders or ${r.freeStart.freeMonths} months · ${r.freeStart.branchesInPool} branches in it`
                                : r.freeStart.ended ? `It ended on ${new Date(r.freeStart.endedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}. Every branch is billed from the first full month after that.` : 'A new branch is billed from the first full month after it goes live (the month it goes live in is not billed).'}
                        </Text>
                        {supreme && !r.freeStart.ended ? (
                            r.freeStart.on
                                ? <Button title="End the free start now" kind="outline" small loading={busy} style={{ marginTop: spacing.md }} onPress={() => saveFree(false)} />
                                : <Button title="Give new branches a shared free start" kind="outline" small style={{ marginTop: spacing.md }} onPress={() => { setFreeOrders(''); setFreeMonths(''); setFreeOpen(true); }} />
                        ) : null}
                    </Card>
                </>
            ) : null}
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
                    <SectionTitle section="money">Money actions for several branches</SectionTitle>
                    <Card style={{ marginBottom: spacing.md }}>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Choose the branches, then the action. You see what was done for each branch afterwards.</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                            <Button title="All branches" small kind={pick === 'all' ? 'primary' : 'outline'} onPress={() => setPick('all')} />
                            {r.branches.map((b) => <Button key={b.id} title={b.name} small kind={pick !== 'all' && pick.includes(b.id) ? 'primary' : 'outline'} onPress={() => togglePick(b.id)} />)}
                        </View>
                        <View style={{ marginTop: spacing.md, gap: spacing.sm }}>
                            <Button title="Waive late fees" kind="outline" small disabled={pick !== 'all' && !pick.length} onPress={() => { setReason(''); setBulk('waive'); }} />
                            <Button title="Mark bills paid" kind="outline" small disabled={pick !== 'all' && !pick.length} onPress={() => { setRef(''); setBnote(''); setBulk('paid'); }} />
                            <Button title="Mark a month's bills not paid" kind="outline" small disabled={pick !== 'all' && !pick.length} onPress={() => { setMonth(''); setBulk('unpaid'); }} />
                        </View>
                    </Card>
                    <SectionTitle section="platform">Manage</SectionTitle>
                    <Button title="Add a branch" icon="add" onPress={() => setAdd(true)} />
                    <Button title="Add an existing shop" icon="shops" kind="outline" style={{ marginTop: spacing.sm }} onPress={() => { setChosen(null); setQ(''); setAcity(''); setAtt(true); }} />
                    <Button title={`Rent discount for the 2nd branch onward: ${r.brand.discountPercent || 0}%`} kind="outline" style={{ marginTop: spacing.sm }} onPress={() => { setDisc(String(r.brand.discountPercent || '')); setDiscOpen(true); }} />
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

            <Sheet visible={!!bulk} onClose={() => setBulk(null)} title={bulk === 'waive' ? 'Waive late fees' : bulk === 'paid' ? 'Mark bills paid' : "Mark a month's bills not paid"}>
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>{`For: ${pickedNames}.`}</Text>
                {bulk === 'waive' ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Every unpaid late fee of these branches is cancelled. The rent bills stay as they are.</Text>
                        <Field label="Reason (the owners may see it)" placeholder="e.g. Rent paid late, please remember the due date" hint="The owners may read this, so write it politely." value={reason} onChangeText={setReason} maxLength={200} />
                    </>
                ) : null}
                {bulk === 'paid' ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Every unpaid bill of these branches, rent and late fees, is marked paid by hand. Use this only when the money really arrived.</Text>
                        <Text style={{ color: t.text, fontWeight: '700', marginBottom: 6 }}>How was it paid?</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                            {['upi', 'bank_transfer', 'cash', 'cheque', 'other'].map((m) => <Button key={m} title={m.replace('_', ' ')} small kind={mode === m ? 'primary' : 'outline'} onPress={() => setMode(m)} />)}
                        </View>
                        <Text style={{ color: t.text, fontWeight: '700', marginBottom: 6 }}>Who received the money?</Text>
                        <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md }}>
                            <Button title="Owner" small kind={receiver === 'owner' ? 'primary' : 'outline'} onPress={() => setReceiver('owner')} />
                            <Button title="Partner" small kind={receiver === 'partner' ? 'primary' : 'outline'} onPress={() => setReceiver('partner')} />
                        </View>
                        <Field label="Payment reference (optional)" placeholder="e.g. UTR 4021XXXX or cheque no." hint="The bank reference of the payment, for your records." value={ref} onChangeText={setRef} maxLength={60} />
                        <Field label="Note (optional)" placeholder="e.g. Paid by bank transfer, ref 12345" hint="For your own records. Not shown to anyone else." value={bnote} onChangeText={setBnote} maxLength={200} />
                    </>
                ) : null}
                {bulk === 'unpaid' ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>The paid rent bills of this month go back to unpaid. A bill paid online is never undone here: that money was really taken.</Text>
                        <Field label="Month (like 2026-10)" placeholder="e.g. 2026-10" hint="The month this applies to (year-month)." value={month} onChangeText={(v) => setMonth(v.replace(/[^0-9-]/g, '').slice(0, 7))} keyboardType="number-pad" />
                    </>
                ) : null}
                <Button title="Do it" loading={busy} disabled={(bulk === 'waive' && reason.trim().length < 3) || (bulk === 'unpaid' && !/^\d{4}-\d{2}$/.test(month))} onPress={runBulk} />
            </Sheet>

            <Sheet visible={!!result} onClose={() => setResult(null)} title="What was done">
                {result ? (
                    <>
                        <Text style={{ color: t.text, fontWeight: '800', marginBottom: spacing.sm }}>{`${result.totals.done} bill${result.totals.done === 1 ? '' : 's'} changed, ₹${result.totals.amount}${result.totals.skipped ? `, ${result.totals.skipped} skipped` : ''}`}</Text>
                        {result.rows.map((row) => (
                            <View key={row.slug} style={{ marginBottom: spacing.sm }}>
                                <Text style={{ color: t.text, fontWeight: '700' }}>{`${row.name}: ${row.done} changed${row.amount ? ` (₹${row.amount})` : ''}`}</Text>
                                {row.skipped.map((k, i) => <Text key={i} style={{ color: t.warn, fontSize: font.sm }}>{`Skipped ${k.invoiceNo}: ${k.reason}`}</Text>)}
                            </View>
                        ))}
                        <Button title="Close" kind="outline" onPress={() => setResult(null)} />
                    </>
                ) : null}
            </Sheet>

            <Sheet visible={freeOpen} onClose={() => setFreeOpen(false)} title="Shared free start">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>All branches that are still free now, and every branch you add while it runs, share ONE free start. It starts when the first one goes live and ends when they have sold the free orders together or the free months are over. Then all of them are billed from the first full month after, on the usual bill day. Leave the numbers empty for the platform's (100 orders, 2 months).</Text>
                <Field label="Free orders (all branches together)" placeholder="e.g. 300" hint="Free orders shared by all the brand's branches before rent starts." value={freeOrders} onChangeText={(v) => setFreeOrders(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" />
                <Field label="Free months" placeholder="e.g. 2" hint="Months after going live without rent. Empty = the platform value." value={freeMonths} onChangeText={(v) => setFreeMonths(v.replace(/\D/g, '').slice(0, 3))} keyboardType="number-pad" />
                <Button title="Switch it on" loading={busy} onPress={() => saveFree(true)} />
            </Sheet>

            <Sheet visible={discOpen} onClose={() => setDiscOpen(false)} title="Rent discount">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>{`The 2nd branch onward pays this much less rent each month (the first branch pays full). Suggested ${cfg ? cfg.defaultDiscountPercent : 10}%, at most ${cfg ? cfg.maxDiscountPercent : 15}%. 0 switches it off.`}</Text>
                <Field label="Discount in percent" placeholder="e.g. 10" hint="Percent off the rent of the brand's second branch onward. 0 = no discount." value={disc} onChangeText={(v) => setDisc(v.replace(/[^0-9.]/g, '').slice(0, 5))} keyboardType="decimal-pad" />
                <Button title="Save" loading={busy} onPress={saveDisc} />
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
