// On the table bill: ask the staff for something, add a tip for the waiter, and split the bill between friends.
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Card, Button } from '../owners/ui';
import { Chip } from './cartParts';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { callTable, setTableTip } from '../../api/customers/shopApi';
import { showToast } from './shop';
import { tr } from '../../i18n';

const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const KINDS = [['waiter', 'Call the waiter'], ['water', 'Water'], ['cutlery', 'Spoon / plate / tissue'], ['clean', 'Clean the table'], ['other', 'Something else']];
const errOf = (e) => e?.response?.data?.error || tr('Could not send. Please try again.');

export function CallCard() {
    const { text, muted, border, surface, primary } = useBrand();
    const on = !!useHomeStore((s) => s.full.orders.dineIn?.callOn);
    const [other, setOther] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    if (!on) return null;
    const send = async (kind, words) => {
        if (busy) return;
        setBusy(true);
        try { await callTable(kind, words); showToast(tr('The staff have been told')); setOther(false); setNote(''); } catch (e) { showToast(errOf(e)); } finally { setBusy(false); }
    };
    return (
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Ionicons name="hand-left" size={20} color={primary} />
                <Text style={{ color: text, fontWeight: '900', marginLeft: 8 }}>{tr('Need something?')}</Text>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {KINDS.map(([k, label]) => <Chip key={k} label={tr(label)} on={k === 'other' && other} onPress={() => (k === 'other' ? setOther((x) => !x) : send(k))} />)}
            </View>
            {other ? (
                <View style={{ marginTop: 4 }}>
                    <TextInput value={note} onChangeText={setNote} maxLength={120} placeholder={tr('Tell us what you need')} placeholderTextColor={muted}
                        style={{ borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 10, padding: 12 }} />
                    <Button label={tr('Send')} icon="send" busy={busy} disabled={!note.trim()} onPress={() => send('other', note.trim())} style={{ marginTop: 10 }} />
                </View>
            ) : null}
        </Card>
    );
}

export function TipCard({ bill }) {
    const { text, muted, border, surface, primary } = useBrand();
    const dine = useHomeStore((s) => s.full.orders.dineIn) || {};
    const [custom, setCustom] = useState(false);
    const [amt, setAmt] = useState('');
    const [busy, setBusy] = useState(false);
    if (!dine.tipOn) return null;
    const choices = dine.tipChoices?.length ? dine.tipChoices : [10, 20, 50];
    const tip = bill.tip || 0;
    const set = async (n) => {
        if (busy) return;
        setBusy(true);
        try { await setTableTip(n); await useTableBill.getState().load(); setCustom(false); setAmt(''); } catch (e) { showToast(errOf(e)); } finally { setBusy(false); }
    };
    return (
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6 }}>
                <Ionicons name="heart" size={20} color={primary} />
                <Text style={{ color: text, fontWeight: '900', marginLeft: 8, flex: 1 }}>{tr('Tip for the waiter')}</Text>
                {tip > 0 ? <Text style={{ color: primary, fontWeight: '900' }}>{rs(tip)}</Text> : null}
            </View>
            <Text style={{ color: muted, fontSize: 12.5, marginBottom: 10 }}>{tr('Optional. It is added to your bill and goes to the staff.')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                <Chip label={tr('No tip')} on={tip === 0 && !custom} onPress={() => set(0)} />
                {choices.map((n) => <Chip key={n} label={rs(n)} on={tip === n && !custom} onPress={() => set(n)} />)}
                <Chip label={tr('Other')} on={custom} onPress={() => setCustom((x) => !x)} />
            </View>
            {custom ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4 }}>
                    <TextInput value={amt} onChangeText={(v) => setAmt(v.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" placeholder="₹" placeholderTextColor={muted}
                        style={{ flex: 1, borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 10, padding: 12, marginRight: 10 }} />
                    <Button label={tr('Add')} busy={busy} disabled={!amt || Number(amt) < 1} onPress={() => set(Number(amt))} style={{ minWidth: 100 }} />
                </View>
            ) : null}
        </Card>
    );
}

export function SplitCard({ bill }) {
    const { text, muted, ok, primary, border } = useBrand();
    const user = useAuthStore((s) => s.user);
    const me = String(user?.id || user?._id || '');
    const shares = bill.shares || [];
    const base = bill.payable ?? bill.due;
    const [n, setN] = useState(Math.max(2, shares.length));
    if (!(base > 0)) return null;
    const each = Math.ceil((base / n) * 100) / 100;
    const step = (d) => setN((x) => Math.min(20, Math.max(2, x + d)));
    return (
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Ionicons name="people" size={20} color={primary} />
                <Text style={{ color: text, fontWeight: '900', marginLeft: 8 }}>{tr('Split the bill')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={{ flex: 1, color: muted, fontWeight: '700' }}>{tr('Equally between')}</Text>
                <Button label="−" kind="ghost" onPress={() => step(-1)} style={{ width: 48 }} />
                <Text style={{ color: text, fontWeight: '900', fontSize: 18, minWidth: 54, textAlign: 'center' }}>{tr('{n} people', { n })}</Text>
                <Button label="+" kind="ghost" onPress={() => step(1)} style={{ width: 48 }} />
            </View>
            <View style={{ flexDirection: 'row', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: alpha(border, 0.7) }}>
                <Text style={{ flex: 1, color: text, fontWeight: '900' }}>{tr('Each pays')}</Text>
                <Text style={{ color: ok, fontWeight: '900', fontSize: 18 }}>{rs(each)}</Text>
            </View>
            {shares.length > 1 ? (
                <View style={{ marginTop: 12 }}>
                    <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>{tr('OR BY WHO ORDERED')}</Text>
                    {shares.map((x) => (
                        <View key={x.userId} style={{ flexDirection: 'row', paddingVertical: 3 }}>
                            <Text style={{ flex: 1, color: text, fontWeight: '700' }} numberOfLines={1}>{x.name || tr('Guest')}{x.userId === me ? ` (${tr('you')})` : ''}</Text>
                            <Text style={{ color: text, fontWeight: '800' }}>{rs(x.total)}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
            <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('This is only a guide. You still pay once, at the counter.')}</Text>
        </Card>
    );
}
