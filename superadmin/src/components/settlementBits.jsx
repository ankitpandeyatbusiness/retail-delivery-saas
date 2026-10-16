import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, font } from '../theme';
import { Badge, Button, Chip } from './ui';
import { Field } from './inputs';
import { Sheet, toast } from './feedback';
import { errMsg } from '../api/adminClient';
import { setHandover } from '../api/legalApi';
import { addSettlementCost, markSettlementPaid, claimSettlementPaid, setOffSettlement, fetchSettlementEntries, fetchSettlementConfig, setShopBroughtBy } from '../api/settlementApi';
import { useSupreme } from '../hooks/useSupreme';

export const rs = (n) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
export const dayOf = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '');
export const today = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10);
const validDay = (v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)));
const num = (v) => Number(String(v).replace(/[^\d.]/g, ''));

export const COST_LABEL = { sms_recharge: 'SMS recharge', server: 'Server', database: 'Database', api: 'API / services', misc: 'Other' };
export const CATEGORY_LABEL = { rent: 'Rent', setup: 'Setup fee', topup: 'SMS top-up', adjustment: 'Adjustment', ...COST_LABEL };

// who a side is called on the sheet
export const nameOf = (cfg, side) => (side === 'owner' ? cfg.ownerName : side === 'partner' ? cfg.partnerName : '');

export function StatusBadge({ row }) {
    if (row.voided) return <Badge label="Cancelled" tone="neutral" />;
    if (row.claim?.state === 'open' && row.status !== 'paid') return <Badge label="Says paid" tone="info" />;
    if (row.status === 'paid') return <Badge label={row.owes ? 'Paid' : 'Nothing due'} tone="success" />;
    if (row.late) return <Badge label={row.status === 'partial' ? 'Part paid · late' : 'Late'} tone="danger" />;
    return <Badge label={row.status === 'partial' ? 'Part paid' : 'Pending'} tone="warn" />;
}

// one line of the sheet: what it is on the left, what is left to pay on the right
export function EntryRow({ row, cfg, onPress, last }) {
    const t = useTheme();
    const what = row.kind === 'receipt'
        ? [row.shopName || 'Shop', CATEGORY_LABEL[row.category] || row.category].join(' · ')
        : `${CATEGORY_LABEL[row.category] || row.category} · paid by ${nameOf(cfg, row.paidBy) || 'one of you'}`;
    const who = row.voided ? 'The payment was undone'
        : row.owes ? `${nameOf(cfg, row.owes)} pays ${nameOf(cfg, row.owes === 'owner' ? 'partner' : 'owner')}${row.status !== 'paid' ? ` · by ${dayOf(row.dueAt)}` : ''}`
            : 'Nothing to settle';
    const amount = row.voided || !row.owes ? null : (row.status === 'paid' ? row.dueAmount : row.remaining);
    return (
        <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.border }}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: spacing.md }}>
                <Text style={{ color: t.text, fontWeight: '800' }} numberOfLines={1}>#{row.no} · {row.title}</Text>
                <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 1 }} numberOfLines={1}>{what}</Text>
                <Text style={{ color: row.late ? t.danger : t.muted, fontSize: font.sm, marginTop: 1, fontWeight: row.late ? '700' : '500' }} numberOfLines={1}>{who}</Text>
            </View>
            <View style={{ alignItems: 'flex-end', flexShrink: 0, maxWidth: '38%' }}>
                {amount !== null ? <Text style={{ color: row.status === 'paid' ? t.muted : t.text, fontWeight: '900', fontSize: font.lg }} numberOfLines={1} adjustsFontSizeToFit>{rs(amount)}</Text> : null}
                <View style={{ marginTop: 4 }}><StatusBadge row={row} /></View>
            </View>
        </Pressable>
    );
}

// "Add a shared cost" (supreme admin)
export function CostSheet({ visible, onClose, cfg, onDone }) {
    const [category, setCategory] = useState('sms_recharge');
    const [title, setTitle] = useState('');
    const [amount, setAmount] = useState('');
    const [paidBy, setPaidBy] = useState('partner');
    const [date, setDate] = useState(today());
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible) { setTitle(''); setAmount(''); setNote(''); setDate(today()); } }, [visible]);
    const half = num(amount) * (100 - cfg.costOwnerPct) / 100;

    const save = async () => {
        if (!(num(amount) > 0)) { toast('Enter the amount', 'error'); return; }
        if (!validDay(date)) { toast('Date looks like 2026-10-31', 'error'); return; }
        setBusy(true);
        try {
            await addSettlementCost({ category, title: title.trim(), amount: num(amount), paidBy, date: date || undefined, note: note.trim() || undefined });
            toast('Cost added'); onDone(); onClose();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title="Add a shared cost">
            <Text style={{ color: '#888', fontSize: font.sm, marginBottom: spacing.sm }}>Split {cfg.costOwnerPct} / {100 - cfg.costOwnerPct}. One of you paid all of it; the other one owes his share.</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md }}>
                {Object.entries(COST_LABEL).map(([k, v]) => <Chip key={k} label={v} active={category === k} onPress={() => setCategory(k)} />)}
            </View>
            <Field label="What for (optional)" value={title} onChangeText={setTitle} maxLength={120} placeholder="e.g. Server for October" />
            <Field label="Amount (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" hint={num(amount) > 0 ? `The other one owes ${rs(half)}` : undefined} />
            <Text style={{ fontWeight: '600', marginBottom: 6 }}>Who paid it</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg }}>
                <Chip label={cfg.ownerName} active={paidBy === 'owner'} onPress={() => setPaidBy('owner')} />
                <Chip label={cfg.partnerName} active={paidBy === 'partner'} onPress={() => setPaidBy('partner')} />
            </View>
            <Field label="Date paid" value={date} onChangeText={setDate} placeholder="2026-10-31" maxLength={10} />
            <Field label="Note (bill number, anything)" value={note} onChangeText={setNote} maxLength={300} />
            <Button title="Add cost" icon="check" onPress={save} loading={busy} />
        </Sheet>
    );
}

// money moved: the supreme admin records it. Or: the partner says "I have paid" (claim = true).
export function PaySheet({ visible, onClose, row, claim, onDone }) {
    const [amount, setAmount] = useState('');
    const [date, setDate] = useState(today());
    const [ref, setRef] = useState('');
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { if (visible && row) { setAmount(String(row.remaining)); setDate(today()); setRef(''); setNote(''); } }, [visible, row]);
    if (!row) return null;

    const save = async () => {
        if (!(num(amount) > 0)) { toast('Enter the amount', 'error'); return; }
        if (!validDay(date)) { toast('Date looks like 2026-10-31', 'error'); return; }
        setBusy(true);
        try {
            const body = { amount: num(amount), date: date || undefined, ref: ref.trim() || undefined, note: note.trim() || undefined };
            if (claim) await claimSettlementPaid(row._id, body); else await markSettlementPaid(row._id, body);
            toast(claim ? 'Noted. The supreme admin will confirm it.' : 'Saved'); onDone(); onClose();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title={claim ? 'I have paid' : 'Record a payment'}>
            <Field label={`Amount (₹), up to ${rs(row.remaining)}`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" />
            <Field label="Date the money moved" value={date} onChangeText={setDate} placeholder="2026-10-31" maxLength={10} />
            <Field label="Reference (UPI / bank)" value={ref} onChangeText={setRef} maxLength={60} />
            <Field label="Note" value={note} onChangeText={setNote} maxLength={300} />
            <Button title={claim ? 'Send the note' : 'Save payment'} icon="check" onPress={save} loading={busy} />
        </Sheet>
    );
}

// Set what one owes against what the other owes. `row` is one side; the other side is picked from the open rows.
export function SetOffSheet({ visible, onClose, row, cfg, onDone }) {
    const t = useTheme();
    const [list, setList] = useState(null);
    const [pick, setPick] = useState(null);
    const [amount, setAmount] = useState('');
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const want = row?.owes === 'partner' ? 'owner' : 'partner';   // the opposite direction

    useEffect(() => {
        if (!visible || !row) return;
        setPick(null); setAmount(''); setReason(''); setList(null);
        fetchSettlementEntries({ status: 'open', limit: 100 }).then((r) => setList(r.items.filter((x) => x.owes === want && x._id !== row._id))).catch(() => setList([]));
    }, [visible, row, want]);
    if (!row) return null;
    const max = pick ? Math.min(row.remaining, pick.remaining) : 0;

    const save = async () => {
        if (!pick) { toast('Pick the other row', 'error'); return; }
        if (!reason.trim()) { toast('Write the reason', 'error'); return; }
        if (!(num(amount) > 0) || num(amount) > max + 0.005) { toast(`The amount is up to ${rs(max)}`, 'error'); return; }
        setBusy(true);
        try {
            const a = row.owes === 'partner' ? row : pick;
            const b = row.owes === 'partner' ? pick : row;
            await setOffSettlement({ fromPartnerId: a._id, fromOwnerId: b._id, amount: num(amount), reason: reason.trim() });
            toast('Set off'); onDone(); onClose();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <Sheet visible={visible} onClose={onClose} title="Set off against another row">
            <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.sm }}>
                #{row.no}: {nameOf(cfg, row.owes)} owes {rs(row.remaining)}. Pick a row where {nameOf(cfg, want)} owes, and the smaller amount is set against each other.
            </Text>
            {list === null ? <Text style={{ color: t.muted }}>Loading…</Text> : null}
            {list && !list.length ? <Text style={{ color: t.muted, marginBottom: spacing.md }}>There is no open row where {nameOf(cfg, want)} owes.</Text> : null}
            {(list || []).map((x) => (
                <Pressable key={x._id} onPress={() => { setPick(x); setAmount(String(Math.min(row.remaining, x.remaining))); }}
                    style={{ padding: spacing.md, borderRadius: 12, borderWidth: 1, borderColor: pick?._id === x._id ? t.primary : t.border, marginBottom: spacing.sm }}>
                    <Text style={{ color: t.text, fontWeight: '800' }}>#{x.no} · {x.title}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm }}>{nameOf(cfg, x.owes)} owes {rs(x.remaining)}</Text>
                </Pressable>
            ))}
            {pick ? <Field label={`Amount to set off (₹), up to ${rs(max)}`} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" /> : null}
            {pick ? <Field label="Reason (typed by you)" value={reason} onChangeText={setReason} maxLength={300} placeholder="e.g. Recharge of 12 Oct against rent" /> : null}
            <Button title="Set off" icon="check" onPress={save} loading={busy} disabled={!pick} />
        </Sheet>
    );
}

// "Who brought this shop": decides the revenue split on the settlement sheet. Everybody sees it; only the supreme admin sets it.
export function BroughtByCard({ shopId, current, onChanged }) {
    const t = useTheme();
    const supreme = useSupreme();
    const [cfg, setCfg] = useState(null);
    const [busy, setBusy] = useState(false);
    useEffect(() => { fetchSettlementConfig().then(setCfg).catch(() => { }); }, []);
    if (!cfg) return null;
    const set = async (side) => {
        if (side === current || busy) return;
        setBusy(true);
        try {
            const r = await setShopBroughtBy(shopId, side);
            toast(r.rowsLocked ? `Saved. ${r.rowsLocked} row(s) already settled keep their old ratio.` : 'Saved');
            onChanged?.();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const pct = (side) => (side === 'owner' ? cfg.ownerPctOwnerBrought : cfg.ownerPctPartnerBrought);
    return (
        <View style={{ marginBottom: spacing.md, padding: spacing.lg, borderRadius: 16, backgroundColor: t.surface }}>
            <Text style={{ color: t.text, fontWeight: '800' }}>Who brought this shop</Text>
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                {current ? `${current === 'owner' ? cfg.ownerName : cfg.partnerName} brought it: ${cfg.ownerName} gets ${pct(current)}% and ${cfg.partnerName} ${100 - pct(current)}% of what it pays (before GST).` : 'Not marked yet. Until it is marked, the partner-brought ratio is used and the sheet says so.'}
            </Text>
            {supreme ? (
                <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                    <Chip label={`${cfg.ownerName} brought it`} active={current === 'owner'} onPress={() => set('owner')} />
                    <Chip label={`${cfg.partnerName} brought it`} active={current === 'partner'} onPress={() => set('partner')} />
                </View>
            ) : null}
        </View>
    );
}

// while creating a shop: who brought it (only the supreme admin sees this)
export function BroughtByPicker({ value, onChange }) {
    const t = useTheme();
    const supreme = useSupreme();
    const [cfg, setCfg] = useState(null);
    useEffect(() => { if (supreme) fetchSettlementConfig().then(setCfg).catch(() => { }); }, [supreme]);
    if (!supreme || !cfg) return null;
    return (
        <View style={{ marginBottom: spacing.lg }}>
            <Text style={{ color: t.text, fontSize: font.sm, fontWeight: '600', marginBottom: 6 }}>Who brought this shop</Text>
            <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                <Chip label={`${cfg.ownerName} brought it`} active={value === 'owner'} onPress={() => onChange('owner')} />
                <Chip label={`${cfg.partnerName} brought it`} active={value === 'partner'} onPress={() => onChange('partner')} />
            </View>
            <Text style={{ color: t.muted, fontSize: font.xs, marginTop: 4 }}>Decides how its payments are shared on the settlement sheet. You can change it later.</Text>
        </View>
    );
}

// "Mark as handed over to the client": from then on the shop's owner and riders are asked to agree to the terms on their second visit.
// Everybody sees the state; only the supreme admin presses the button.
export function HandoverCard({ shopId, handedOverAt, onChanged }) {
    const t = useTheme();
    const supreme = useSupreme();
    const [busy, setBusy] = useState(false);
    if (!supreme && !handedOverAt) return null;
    const go = async (on) => {
        setBusy(true);
        try { await setHandover(shopId, on); toast(on ? 'Marked as handed over. Their owner and riders will be asked to agree on their second visit.' : 'Handover mark removed'); onChanged?.(); }
        catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    return (
        <View style={{ marginBottom: spacing.md, padding: spacing.lg, borderRadius: 16, backgroundColor: t.surface }}>
            <Text style={{ color: t.text, fontWeight: '800' }}>Handover to the client</Text>
            <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                {handedOverAt ? `Handed over on ${dayOf(handedOverAt)}. The owner and riders are asked to agree to the terms on their second visit.` : 'Not handed over yet, so nobody here is asked to agree to anything. Press this when you give the app to the client.'}
            </Text>
            {supreme ? (
                <View style={{ marginTop: spacing.md }}>
                    {handedOverAt ? <Button title="Remove the handover mark" kind="outline" onPress={() => go(false)} loading={busy} /> : <Button title="Mark as handed over to the client" icon="check" onPress={() => go(true)} loading={busy} />}
                </View>
            ) : null}
        </View>
    );
}
