// On the table bill: ask the staff for something, add a tip for the waiter, and split the bill between friends.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { Card, Button } from '../owners/ui';
import { Chip } from './cartParts';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useAuthStore } from '../../store/common/useAuthStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { callTable, setTableTip, askLeaveShare } from '../../api/customers/shopApi';
import { ask } from '../common/dialog';
import { showToast } from './shop';
import { tr } from '../../i18n';

const rs = (n) => `₹${Math.round(n * 100) / 100}`;
const KINDS = [['water', 'Water'], ['cutlery', 'Spoon / plate / tissue'], ['clean', 'Clean the table'], ['other', 'Something else']];
const errOf = (e) => e?.response?.data?.error || tr('Could not send. Please try again.');

// the shop's switch for the call options may have been turned on after this phone loaded the shop's settings: read them again (at most once a minute)
let configAt = 0;
export function CallCard() {
    const { text, muted, border, surface, primary } = useBrand();
    const on = !!useHomeStore((s) => s.full.orders.dineIn?.callOn);
    useEffect(() => { if (Date.now() - configAt > 60000) { configAt = Date.now(); useHomeStore.getState().load(); } }, []);
    const [other, setOther] = useState(false);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const send = async (kind, words) => {
        if (busy) return;
        setBusy(true);
        try { await callTable(kind, words); showToast(kind === 'waiter' ? tr('The waiter has been called') : tr('The staff have been told')); setOther(false); setNote(''); } catch (e) { showToast(errOf(e)); } finally { setBusy(false); }
    };
    return (
        <View style={{ marginBottom: 14 }}>
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                <Ionicons name="hand-left" size={20} color={primary} />
                <Text style={{ color: text, fontWeight: '900', marginLeft: 8 }}>{tr('Need something?')}</Text>
            </View>
            {/* always there, as often as the guest needs: only the waiters are told */}
            <Button label={tr('Call the waiter')} icon="hand-left" busy={busy} onPress={() => send('waiter')} style={{ marginBottom: on ? 10 : 0, marginHorizontal: -6, minHeight: 54 }} />
            {on ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {KINDS.map(([k, label]) => <Chip key={k} label={tr(label)} on={k === 'other' && other} onPress={() => (k === 'other' ? setOther((x) => !x) : send(k))} />)}
            </View>
            ) : null}
            {on && other ? (
                <View style={{ marginTop: 4 }}>
                    <TextInput value={note} onChangeText={setNote} maxLength={120} placeholder={tr('Tell us what you need')} placeholderTextColor={muted}
                        style={{ borderWidth: 1, borderColor: border, backgroundColor: surface, color: text, borderRadius: 10, padding: 12 }} />
                    <Button label={tr('Send')} icon="send" busy={busy} disabled={!note.trim()} onPress={() => send('other', note.trim())} style={{ marginTop: 10 }} />
                </View>
            ) : null}
        </Card>
        </View>
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
    const { text, muted, ok, primary, border, surface } = useBrand();
    const user = useAuthStore((s) => s.user);
    const me = String(user?.id || user?._id || '');
    const shares = bill.shares || [];
    const base = bill.payable ?? bill.due;
    const [n, setN] = useState(1);   // he is alone until he says otherwise: he sees his whole amount at once
    const [asking, setAsking] = useState(false);
    const [asked, setAsked] = useState(false);
    if (!(base > 0)) return null;
    const mine = shares.find((x) => x.userId === me);
    const myDue = Math.round((mine?.due || 0) * 100) / 100;
    // someone else is on this bill and he is done: he pays his own share and goes (the waiter takes it)
    const leave = async () => {
        const yes = await ask({ title: tr('Pay your share and leave?'), message: tr('Your share is {amount}. The waiter comes to take it. Your friends stay on the bill with theirs.', { amount: rs(myDue) }), confirmText: tr('Yes, call the waiter'), cancelText: tr('Not yet') });
        if (!yes) return;
        setAsking(true);
        try { const r = await askLeaveShare(); setAsked(true); showToast(r.busy ? tr('Your dishes are still being made. Pay after they are served.') : tr('The waiter is on the way')); } catch (e) { showToast(e?.response?.data?.error || tr('Could not ask. Try again.')); } finally { setAsking(false); }
    };
    const each = Math.ceil((base / n) * 100) / 100;
    const step = (d) => setN((x) => Math.min(20, Math.max(1, x + d)));
    const dot = (icon, d, off) => (
        <Pressable onPress={() => step(d)} disabled={off} hitSlop={6} style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: off ? alpha(muted, 0.12) : alpha(primary, 0.14) }}>
            <Ionicons name={icon} size={20} color={off ? muted : primary} />
        </Pressable>
    );
    return (
        <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Ionicons name="people" size={20} color={primary} />
                <Text style={{ color: text, fontWeight: '900', marginLeft: 8, flex: 1 }}>{tr('Split the bill')}</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
                <Text style={{ flex: 1, color: muted, fontWeight: '700' }}>{tr('How many are eating?')}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', padding: 4, borderRadius: 24, borderWidth: 1, borderColor: border, backgroundColor: surface }}>
                    {dot('remove', -1, n <= 1)}
                    <Text style={{ color: text, fontWeight: '900', fontSize: 18, minWidth: 44, textAlign: 'center' }}>{n}</Text>
                    {dot('add', 1, n >= 20)}
                </View>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, padding: 14, borderRadius: 14, backgroundColor: alpha(ok, 0.1) }}>
                <Text style={{ flex: 1, color: text, fontWeight: '800' }}>{n === 1 ? tr('You pay') : tr('Each pays')}</Text>
                <Text style={{ color: ok, fontWeight: '900', fontSize: 22 }}>{rs(each)}</Text>
            </View>
            {shares.length > 1 ? (
                <View style={{ marginTop: 14 }}>
                    <Text style={{ color: muted, fontWeight: '800', fontSize: 12.5, marginBottom: 4 }}>{tr('OR BY WHO ORDERED')}</Text>
                    {shares.map((x) => (
                        <View key={x.userId} style={{ flexDirection: 'row', paddingVertical: 3 }}>
                            <Text style={{ flex: 1, color: text, fontWeight: '700' }} numberOfLines={1}>{x.name || tr('Guest')}{x.userId === me ? ` (${tr('you')})` : ''}</Text>
                            <Text style={{ color: text, fontWeight: '800' }}>{rs(x.total)}</Text>
                        </View>
                    ))}
                </View>
            ) : null}
            {shares.length > 1 && mine && myDue > 0 ? (
                <View style={{ marginTop: 14 }}>
                    {asked ? <Text style={{ color: ok, fontWeight: '800', textAlign: 'center' }}>{tr('The waiter knows. Please wait at your table.')}</Text> : <Button label={tr('Pay my share and leave')} icon="walk" kind="ghost" busy={asking} onPress={leave} />}
                </View>
            ) : null}
            <Text style={{ color: muted, fontSize: 12, marginTop: 10 }}>{shares.length > 1 ? tr('Pay your own share and leave, or pay together once, at the counter.') : tr('This is only a guide. You still pay once, at the counter.')}</Text>
        </Card>
    );
}
