import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Button, Badge, Card } from '../../components/ui';
import { Group, TextField, Hint, Choice } from '../../components/settingsForm';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, ConfirmSheet, toast } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchOperators, fetchSwitchChecklist, createOperator, updateOperator, saveOperatorKeys, deleteOperator, switchOperator } from '../../api/operatorsApi';
import { errMsg } from '../../api/adminClient';
import { isState } from '../../utils/states';

const FIELDS = ['legalName', 'address', 'gstin', 'pan', 'state', 'sacCode', 'invoicePrefix', 'poweredBy', 'contactPhone', 'email', 'phone', 'paymentInstructions', 'appName'];
const blank = () => ({ label: '', settlementMode: 'split', notes: '', ...Object.fromEntries(FIELDS.map((k) => [k, ''])) });

// One company: its details, its Razorpay keys, how its money is shared, and the Switch button.
export default function OperatorEditScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { id } = useRoute().params || {};
    const supreme = useSupreme();
    const [f, setF] = useState(id ? null : blank());
    const [op, setOp] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const [keys, setKeys] = useState(false);
    const [kid, setKid] = useState('');
    const [ksec, setKsec] = useState('');
    const [kweb, setKweb] = useState('');
    const [sw, setSw] = useState(null);
    const [note, setNote] = useState('');
    const [notify, setNotify] = useState(true);
    const [del, setDel] = useState(false);

    const load = async () => {
        if (!id) return;
        try {
            const r = await fetchOperators();
            const o = r.items.find((x) => x.id === id);
            if (!o) { setErr('Company not found'); return; }
            setOp(o);
            setF({ label: o.label, settlementMode: o.settlementMode, notes: o.notes || '', ...Object.fromEntries(FIELDS.map((k) => [k, o.business[k] || ''])) });
            setErr('');
        } catch (e) { setErr(errMsg(e)); }
    };
    useEffect(() => { load(); }, [id]);   // eslint-disable-line react-hooks/exhaustive-deps

    if (!f) return <Screen title="Company">{err ? <ErrorBox message={err} onRetry={load} /> : <SkeletonList count={3} avatar={false} />}</Screen>;
    const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
    const locked = op?.prefixLocked;

    const save = async () => {
        if (!f.label.trim()) { toast('Give the company a short name', 'error'); return; }
        if (!isState(f.state)) { toast('Enter an Indian state name, like Uttar Pradesh', 'error'); return; }
        setBusy(true);
        try {
            const business = Object.fromEntries(FIELDS.map((k) => [k, f[k].trim()]));
            if (locked) delete business.invoicePrefix;
            const body = { label: f.label.trim(), settlementMode: f.settlementMode, notes: f.notes.trim(), business };
            if (id) await updateOperator(id, body); else await createOperator(body);
            toast('Saved'); nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const saveKeys = async () => {
        setBusy(true);
        try { await saveOperatorKeys(id, { keyId: kid.trim(), keySecret: ksec.trim(), webhookSecret: kweb.trim() || undefined }); toast('Keys saved'); setKeys(false); setKsec(''); setKweb(''); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const openSwitch = async () => {
        try { setSw(await fetchSwitchChecklist(id)); setNote(''); setNotify(true); } catch (e) { toast(errMsg(e), 'error'); }
    };
    const doSwitch = async () => {
        setBusy(true);
        try {
            const r = await switchOperator(id, { note: note.trim() || undefined, notify });
            toast(`${r.to} now runs the platform${r.noticeSent ? '. Every shop was told.' : ''}`); setSw(null); nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title={id ? f.label || 'Company' : 'New company'} footer={supreme ? <Button title="Save details" icon="check" onPress={save} loading={busy} /> : undefined}>
            {op?.active ? (
                <Card style={{ marginBottom: spacing.md }}>
                    <Badge label="This company runs the platform now" tone="success" />
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.sm, lineHeight: 19 }}>Its details are what bills, mails and payments use. Money, Business details and My Razorpay edit this same company, so there is nothing to keep in step.</Text>
                </Card>
            ) : null}
            <Group title="Name" section="platform">
                <TextField label="A short name for yourself" value={f.label} onChange={set('label')} maxLength={80} last />
            </Group>
            <Group title="The company on the bills" section="money" hint="Printed on every bill, receipt and mail once this company is active.">
                <TextField label="Legal name" value={f.legalName} onChange={set('legalName')} maxLength={120} />
                <TextField label="Address" value={f.address} onChange={set('address')} maxLength={250} multiline />
                <TextField label="GST number" value={f.gstin} onChange={(v) => set('gstin')(v.toUpperCase())} maxLength={15} autoCapitalize="characters" />
                <TextField label="PAN" value={f.pan} onChange={(v) => set('pan')(v.toUpperCase())} maxLength={10} autoCapitalize="characters" />
                <TextField label="State" value={f.state} onChange={set('state')} maxLength={40} placeholder="e.g. Uttar Pradesh" />
                <TextField label="SAC code" value={f.sacCode} onChange={set('sacCode')} maxLength={10} keyboardType="number-pad" />
                <TextField label="Email" value={f.email} onChange={set('email')} maxLength={120} autoCapitalize="none" keyboardType="email-address" />
                <TextField label="Phone" value={f.phone} onChange={set('phone')} maxLength={20} keyboardType="phone-pad" />
                <TextField label="How shops pay (printed on pending bills)" value={f.paymentInstructions} onChange={set('paymentInstructions')} maxLength={500} multiline last />
            </Group>
            <Group title="Numbering and the customer app" section="catalog" hint={locked ? 'Bills with this prefix already exist, so the prefix is locked.' : 'Bills are numbered like SUB/<prefix>/2026-27/0001. A new GST number needs a new prefix.'}>
                <TextField label="Invoice prefix" value={f.invoicePrefix} onChange={(v) => !locked && set('invoicePrefix')(v.toUpperCase())} maxLength={12} autoCapitalize="characters" placeholder="e.g. ABC (can be empty)" />
                <TextField label="App name (in mails)" value={f.appName} onChange={set('appName')} maxLength={60} />
                <TextField label="“Powered by” name in the customer app" value={f.poweredBy} onChange={set('poweredBy')} maxLength={40} />
                <TextField label="Contact phone for customers" value={f.contactPhone} onChange={set('contactPhone')} maxLength={20} keyboardType="phone-pad" last />
            </Group>
            <Group title="How its money is shared" section="orders" hint="“All yours” is for your own agency: new payments then show nothing to settle with the partner.">
                <Choice options={[{ value: 'split', label: 'Shared with the partner' }, { value: 'owner_only', label: 'All yours' }]} value={f.settlementMode} onChange={set('settlementMode')} last />
            </Group>

            {id && supreme ? (
                <>
                    <Card style={{ marginTop: spacing.md }}>
                        <Text style={{ color: t.text, fontWeight: '800' }}>Razorpay account</Text>
                        <Text style={{ color: t.muted, marginTop: 2 }}>{op?.hasKeys ? `Keys saved (${op.keyId}). The secret is never shown again.` : 'No keys saved yet. Add this company’s own Razorpay keys.'}</Text>
                        <View style={{ marginTop: spacing.md }}><Button title={op?.hasKeys ? 'Replace the keys' : 'Add the keys'} icon="key" kind="soft" onPress={() => { setKid(op?.keyId || ''); setKeys(true); }} /></View>
                    </Card>
                    {!op?.active ? (
                        <>
                            <View style={{ marginTop: spacing.lg }}><Button title="Switch to this company…" icon="send" onPress={openSwitch} /></View>
                            <View style={{ marginTop: spacing.sm }}><Button title="Delete this company" kind="outline" onPress={() => setDel(true)} /></View>
                        </>
                    ) : null}
                </>
            ) : null}
            {!supreme ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>You can look at this. Only the supreme admin changes it.</Text> : null}

            <Sheet visible={keys} onClose={() => setKeys(false)} title="Razorpay keys">
                <Field label="Key ID" value={kid} onChangeText={setKid} autoCapitalize="none" placeholder="rzp_live_..." />
                <Field label="Key secret" value={ksec} onChangeText={setKsec} autoCapitalize="none" secureTextEntry />
                <Field label="Webhook secret (optional)" value={kweb} onChangeText={setKweb} autoCapitalize="none" secureTextEntry hint="The same secret you paste in this company's Razorpay dashboard" />
                <Button title="Save keys" icon="check" onPress={saveKeys} loading={busy} />
            </Sheet>

            <Sheet visible={!!sw} onClose={() => setSw(null)} title={sw ? `Switch to ${sw.to?.label}` : ''}>
                {sw ? (
                    <>
                        <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.md }}>From the moment you press Switch, new bills, receipts, top-up invoices and payments use this company. Old bills stay as they were.</Text>
                        {sw.items.map((i) => (
                            <View key={i.id} style={{ flexDirection: 'row', marginBottom: spacing.sm }}>
                                <Text style={{ color: i.ok ? t.success || '#16a34a' : (i.blocking ? t.danger : t.warn || '#d97706'), fontWeight: '900', width: 22 }}>{i.ok ? '✓' : i.blocking ? '✕' : '!'}</Text>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: t.text, fontWeight: '700' }}>{i.label}</Text>
                                    {!i.ok && i.detail ? <Text style={{ color: t.muted, fontSize: font.sm }}>{i.detail}</Text> : null}
                                </View>
                            </View>
                        ))}
                        <Field label="A note for the record (optional)" value={note} onChangeText={setNote} maxLength={300} />
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md }}>
                            <Button title={notify ? 'Tell every shop: yes' : 'Tell every shop: no'} kind="outline" small onPress={() => setNotify(!notify)} />
                        </View>
                        <Button title="Switch now" icon="send" onPress={doSwitch} loading={busy} disabled={!sw.canSwitch} />
                        {!sw.canSwitch ? <Text style={{ color: t.danger, fontSize: font.sm, marginTop: spacing.sm }}>Fix the ✕ items first.</Text> : null}
                    </>
                ) : null}
            </Sheet>
            <ConfirmSheet
                visible={del} onClose={() => setDel(false)} title="Delete this company?" message="Only the profile is deleted. Bills already made keep their details." confirmLabel="Delete" danger
                onConfirm={async () => { try { await deleteOperator(id); toast('Deleted'); nav.goBack(); } catch (e) { toast(errMsg(e), 'error'); throw e; } }}
            />
        </Screen>
    );
}
