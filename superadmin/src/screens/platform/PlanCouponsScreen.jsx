import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, SectionTitle, Badge, KeyValue, Chip } from '../../components/ui';
import { Field, Segmented } from '../../components/inputs';
import { DatePickField, ymd } from '../../components/DatePicker';
import { SkeletonList } from '../../components/blocks';
import { Sheet, ConfirmSheet, Empty, toast } from '../../components/feedback';
import { deletePlanCoupon, fetchPlanCoupons, createPlanCoupon, updatePlanCoupon, fetchPlanCouponTexts, notifyPlanCoupon, fetchShops } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

const DAY = 86400000;
const day = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const PLANS = [{ value: 'both', label: 'Growth + Pro' }, { value: 'growth', label: 'Growth' }, { value: 'pro', label: 'Pro' }];
const TERMS = [{ value: 'any', label: 'Any term' }, { value: '3', label: '3 months' }, { value: '6', label: '6 months' }];
const blank = () => ({ code: '', pct: '', plan: 'pro', term: '6', start: ymd(new Date()), end: ymd(new Date(Date.now() + 10 * DAY)), maxUses: '', shops: [], note: '' });

// Coupons for plan payments. The shop sees them as tappable cards on its Plan screen (only if it can use them). The better of the coupon and the 3 / 6 month
// discount applies, never both. Only the supreme admin can make, switch off or send one (the server refuses everyone else).
export default function PlanCouponsScreen() {
    const t = useTheme();
    const [list, setList] = useState(null);
    const [f, setF] = useState(blank());
    const [busy, setBusy] = useState(false);
    const [q, setQ] = useState('');
    const [found, setFound] = useState(null);
    const [send, setSend] = useState(null);       // { coupon, texts, title, body }
    const [off, setOff] = useState(null);
    const [edit, setEdit] = useState(null);       // { c, end, maxUses, note }
    const [del, setDel] = useState(null);

    const load = useCallback(() => { fetchPlanCoupons().then((r) => setList(r.coupons)).catch((e) => { setList([]); toast(errMsg(e), 'error'); }); }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    useEffect(() => {
        if (!q.trim()) { setFound(null); return undefined; }
        const h = setTimeout(() => { fetchShops(q.trim()).then((x) => setFound(x.items || [])).catch(() => setFound([])); }, 300);
        return () => clearTimeout(h);
    }, [q]);

    const set = (k) => (v) => setF({ ...f, [k]: v });
    const addShop = (sh) => { if (!f.shops.some((s) => (s._id || s.id) === (sh._id || sh.id))) setF({ ...f, shops: [...f.shops, sh] }); setQ(''); setFound(null); };

    const create = async () => {
        setBusy(true);
        try {
            const made = await createPlanCoupon({
                code: f.code, pct: Number(f.pct), plans: f.plan === 'both' ? ['growth', 'pro'] : [f.plan], months: f.term === 'any' ? [] : [Number(f.term)],
                startsOn: f.start, endsOn: f.end, maxUses: f.maxUses ? Number(f.maxUses) : null, shops: f.shops.map((s) => s._id || s.id), note: f.note,
            });
            toast(`Coupon ${made.code} made`);
            setF(blank());
            load();
            openSend(made);
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const openSend = async (c) => {
        try { const r = await fetchPlanCouponTexts(c.id); setSend({ coupon: c, texts: r.texts, title: r.texts[0].title, body: r.texts[0].body }); } catch (e) { toast(errMsg(e), 'error'); }
    };
    const doSend = async () => {
        setBusy(true);
        try { const r = await notifyPlanCoupon(send.coupon.id, { title: send.title, body: send.body }); toast(`Sent to ${r.sent} shop${r.sent === 1 ? '' : 's'}`); setSend(null); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const saveEdit = async () => {
        setBusy(true);
        try { await updatePlanCoupon(edit.c.id, { endsOn: edit.end, maxUses: edit.maxUses === '' ? null : Number(edit.maxUses), note: edit.note }); toast('Coupon updated'); setEdit(null); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const toggle = async (c) => { try { await updatePlanCoupon(c.id, { active: !c.active }); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setOff(null); } };

    return (
        <Screen title="Plan coupons" subtitle="Offers for plan payments. Owners see them on their Plan screen.">
            <SectionTitle section="money">New coupon</SectionTitle>
            <Card>
                <Field label="Code" placeholder="e.g. PRO6" hint="Letters and numbers. Owners can also type it." value={f.code} onChangeText={(v) => set('code')(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" maxLength={20} />
                <Field label="Discount %" hint="Whole number from 1 to 90. It is never added to the 3 or 6 month discount: the better one applies." value={f.pct} onChangeText={(v) => set('pct')(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={2} />
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.xs }}>The shop gets the discount when it buys</Text>
                <Segmented options={PLANS} value={f.plan} onChange={set('plan')} />
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.xs }}>Partner has no monthly price, so there is nothing to discount on it. Partner shops, shops in their free period and shops whose plan ended get this coupon when they buy the plan chosen here.</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md, marginBottom: spacing.xs }}>Term</Text>
                <Segmented options={TERMS} value={f.term} onChange={set('term')} />
                <View style={{ height: spacing.md }} />
                <DatePickField label="Starts" value={f.start} onChange={set('start')} title="Start date" />
                <DatePickField label="Ends" hint="Shops whose paid plan runs past this date are not offered it." value={f.end} onChange={set('end')} title="End date" />
                <Field label="Use limit (optional)" hint="Total uses across all shops. Each shop can use it once." value={f.maxUses} onChangeText={(v) => set('maxUses')(v.replace(/\D/g, ''))} keyboardType="number-pad" maxLength={5} />
                <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.xs }}>Shops</Text>
                <Text style={{ color: t.text, marginBottom: spacing.sm }}>{f.shops.length ? 'Only the shops below' : 'All shops that can use it'}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
                    {f.shops.map((s) => <Chip key={s._id || s.id} label={`${s.name}  ✕`} active onPress={() => setF({ ...f, shops: f.shops.filter((x) => (x._id || x.id) !== (s._id || s.id)) })} />)}
                </View>
                <Field label="Add a shop (optional)" placeholder="Search by name" value={q} onChangeText={setQ} />
                {found ? found.slice(0, 8).map((sh) => <Button key={sh._id || sh.id} title={`${sh.name} (${sh.slug})`} kind="outline" small style={{ marginBottom: spacing.sm }} onPress={() => addShop(sh)} />) : null}
                <Field label="Note for yourself (optional)" value={f.note} onChangeText={set('note')} maxLength={200} />
                <Button title="Make coupon" onPress={create} loading={busy} disabled={f.code.length < 3 || !f.pct} />
            </Card>

            <SectionTitle section="money">Coupons</SectionTitle>
            {list === null ? <SkeletonList count={3} /> : !list.length ? <Empty icon="pricetag-outline" title="No coupons yet" hint="Make one above. You can send a push to the shops that can use it." /> : list.map((c) => (
                <Card key={c.id} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm }}>
                        <Text style={{ color: t.text, fontSize: font.lg, fontWeight: '900', flex: 1 }}>{c.code} · {c.pct}% off</Text>
                        <Badge label={!c.active ? 'Off' : c.live ? 'Live' : 'Not live'} tone={!c.active ? 'neutral' : c.live ? 'success' : 'warn'} />
                    </View>
                    <KeyValue label="Plan" value={c.plans.map((p) => (p === 'pro' ? 'Pro' : 'Growth')).join(' + ')} />
                    <KeyValue label="Term" value={c.months.length ? c.months.map((m) => `${m} months`).join(', ') : 'Any'} />
                    <KeyValue label="Dates" value={`${day(c.startsAt)} to ${day(c.endsAt)}`} />
                    <KeyValue label="Shops" value={c.shops.length ? `${c.shops.length} chosen` : 'All that can use it'} />
                    <KeyValue label="Can use it now" value={String(c.eligibleShops)} />
                    <KeyValue label="Used" value={c.maxUses ? `${c.usedCount} of ${c.maxUses}` : String(c.usedCount)} last />
                    {c.notifiedAt ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm }}>Push last sent {day(c.notifiedAt)}</Text> : null}
                    <View style={{ flexDirection: 'row', marginTop: spacing.md }}>
                        <Button title="Send push" small onPress={() => openSend(c)} disabled={!c.live} style={{ marginRight: spacing.sm }} />
                        <Button title={c.active ? 'Switch off' : 'Switch on'} kind="outline" small onPress={() => (c.active ? setOff(c) : toggle(c))} style={{ marginRight: spacing.sm }} />
                        <Button title="Edit" kind="outline" small onPress={() => setEdit({ c, end: ymd(new Date(c.endsAt)), maxUses: c.maxUses ? String(c.maxUses) : '', note: c.note || '' })} />
                    </View>
                </Card>
            ))}

            <Sheet visible={!!send} onClose={() => setSend(null)} title="Send to shops that can use it">
                {send ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>Pick a ready-made text, change it if you like. It goes only to the shops that can use this coupon now ({send.coupon.eligibleShops}).</Text>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: spacing.sm }}>
                            {send.texts.map((x, i) => <Chip key={i} label={`Text ${i + 1}`} active={send.body === x.body} onPress={() => setSend({ ...send, title: x.title, body: x.body })} />)}
                        </View>
                        <Field label="Title" value={send.title} onChangeText={(v) => setSend({ ...send, title: v })} maxLength={80} />
                        <Field label="Message" value={send.body} onChangeText={(v) => setSend({ ...send, body: v })} multiline maxLength={300} />
                        <Button title={`Send to ${send.coupon.eligibleShops} shop${send.coupon.eligibleShops === 1 ? '' : 's'}`} onPress={doSend} loading={busy} disabled={!send.title.trim() || !send.body.trim() || !send.coupon.eligibleShops} />
                    </>
                ) : null}
            </Sheet>
            <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit ? `Edit ${edit.c.code}` : ''}>
                {edit ? (
                    <>
                        <Text style={{ color: t.muted, marginBottom: spacing.sm }}>The code, the discount, the plan and the term cannot change once made (owners may already have seen them). You can move the end day, set the use limit and change your note. To change anything else, switch this off and make a new one.</Text>
                        <DatePickField label="Ends" value={edit.end} onChange={(v) => setEdit({ ...edit, end: v })} title="End date" />
                        <Field label="Use limit (empty = no limit)" value={edit.maxUses} onChangeText={(v) => setEdit({ ...edit, maxUses: v.replace(/\D/g, '').slice(0, 5) })} keyboardType="number-pad" />
                        <Field label="Note for yourself" value={edit.note} onChangeText={(v) => setEdit({ ...edit, note: v })} maxLength={200} />
                        <Button title="Save" onPress={saveEdit} loading={busy} style={{ marginBottom: spacing.sm }} />
                        <Button title={edit.c.usedCount ? 'Cannot delete: it was used' : 'Delete this coupon'} kind="dangerSoft" disabled={edit.c.usedCount > 0} onPress={() => setDel(edit.c)} />
                    </>
                ) : null}
            </Sheet>
            <ConfirmSheet visible={!!del} onClose={() => setDel(null)} icon="trash-outline" title={`Delete ${del ? del.code : ''}?`} message="Nobody has used it. It is removed for good." confirmLabel="Delete" danger onConfirm={async () => { try { await deletePlanCoupon(del.id); toast('Coupon deleted'); setEdit(null); load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } finally { setDel(null); } }} />
            <ConfirmSheet visible={!!off} onClose={() => setOff(null)} icon="pricetag-outline" title={`Switch off ${off?.code || ''}?`} message="Owners will no longer see or use it. Past uses stay." confirmLabel="Switch off" danger onConfirm={() => toggle(off)} />
        </Screen>
    );
}
