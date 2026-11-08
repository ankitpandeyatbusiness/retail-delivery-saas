import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Chip, SectionTitle } from '../../components/ui';
import { Field, SearchBar } from '../../components/inputs';
import { Switch, Hint } from '../../components/settingsForm';
import { TimeField } from '../../components/TimePicker';
import { DatePickField } from '../../components/DatePicker';
import { Sheet, SheetScroll, ConfirmSheet, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { useShopsStore } from '../../store/useShopsStore';
import { planMaintenance, updateMaintenancePlan, fetchMaintenancePlans } from '../../api/exportApi';
import { useSupreme } from '../../hooks/useSupreme';
import { errMsg } from '../../api/adminClient';

const IST = 330 * 60000;
const ymd = (ms) => new Date(ms + IST).toISOString().slice(0, 10);
const DAYS = [{ v: 0, l: 'Today' }, { v: 1, l: 'Tomorrow' }, { v: 2, l: 'In 2 days' }];
const LENGTHS = [{ v: 30, l: '30 minutes' }, { v: 60, l: '1 hour' }, { v: 120, l: '2 hours' }, { v: 240, l: '4 hours' }, { v: 0, l: 'Until I switch it off' }];
const SCOPES = [{ v: 'all', l: 'Every shop' }, { v: 'shops', l: 'Chosen shops' }, { v: 'brand', l: 'A brand' }];
const show = (d) => d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Plan a maintenance: when it starts and ends, which shops, what people are told. Everybody is warned in advance;
// at the start time the apps pause by themselves and open again at the end time (or when you switch it off).
export default function MaintenancePlanScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const editing = useRoute().params?.plan || null;   // a plan that has not started: only its time and words change
    const supreme = useSupreme();
    const shops = useShopsStore((s) => s.items);
    const [scope, setScope] = useState('shops');
    const [shopIds, setShopIds] = useState([]);
    const [brandId, setBrandId] = useState('');
    const hmOf = (ms) => new Date(ms + IST).toISOString().slice(11, 16);
    const minsOf = editing && editing.endAt ? Math.round((new Date(editing.endAt) - new Date(editing.startAt)) / 60000) : 60;
    const [date, setDate] = useState(editing ? ymd(new Date(editing.startAt).getTime()) : ymd(Date.now()));
    const [time, setTime] = useState(editing ? hmOf(new Date(editing.startAt).getTime()) : '21:00');
    const [mins, setMins] = useState(editing && !editing.endAt ? 0 : minsOf);
    const [message, setMessage] = useState(editing ? editing.message || '' : '');
    const [aud, setAud] = useState({ owners: editing?.audience?.owners !== false, staff: editing?.audience?.staff !== false, riders: editing?.audience?.riders !== false });
    const [picker, setPicker] = useState(false);
    const [q, setQ] = useState('');
    const [confirm, setConfirm] = useState(false);

    useEffect(() => { if (!shops.length) useShopsStore.getState().load(); }, [shops.length]);
    // ready-made messages (the server keeps them, with their translations in every language)
    const [presets, setPresets] = useState([]);
    useEffect(() => { fetchMaintenancePlans().then((r) => setPresets(r.presets || [])).catch(() => { }); }, []);
    const brands = useMemo(() => {
        const m = new Map();
        for (const s of shops) if (s.brandId) { const k = String(s.brandId); if (!m.has(k)) m.set(k, { id: k, name: s.stats?.brandName || 'Brand', n: 0 }); m.get(k).n += 1; }
        return [...m.values()];
    }, [shops]);

    const startAt = /^\d{4}-\d{2}-\d{2}$/.test(date) && /^\d{2}:\d{2}$/.test(time) ? new Date(`${date}T${time}:00+05:30`) : null;
    const endAt = startAt && mins ? new Date(startAt.getTime() + mins * 60000) : null;
    const valid = startAt && !Number.isNaN(startAt.getTime()) && startAt.getTime() > Date.now() && (editing || scope === 'all' || (scope === 'shops' && shopIds.length) || (scope === 'brand' && brandId));
    const who = scope === 'all' ? 'Every shop' : scope === 'brand' ? (brands.find((b) => b.id === brandId)?.name || 'The brand') : `${shopIds.length} shop${shopIds.length === 1 ? '' : 's'}`;
    const shown = shops.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

    const save = async () => {
        try {
            if (editing) {
                await updateMaintenancePlan(editing.id, { startAt: startAt.toISOString(), endAt: endAt ? endAt.toISOString() : null, message: message.trim(), audience: aud });
                toast('Changed. Everybody is told the new time.');
                nav.goBack();
                return;
            }
            await planMaintenance({
                scope, ...(scope === 'shops' ? { tenantIds: shopIds } : {}), ...(scope === 'brand' ? { brandId } : {}),
                startAt: startAt.toISOString(), ...(endAt ? { endAt: endAt.toISOString() } : {}), message: message.trim(), audience: aud,
            });
            toast('Planned. Everybody is being told.');
            nav.goBack();
        } catch (e) { toast(errMsg(e), 'error'); throw e; }
    };

    return (
        <Screen title={editing ? 'Change the time' : 'Plan maintenance'} subtitle={editing ? 'The shops stay the same' : 'Warn first, pause at the exact time'} footer={<Button title={editing ? 'Save the change' : 'Plan it'} icon="tool" onPress={() => setConfirm(true)} disabled={!valid} />}>
            {editing ? null : <SectionTitle section="shops">Which shops</SectionTitle>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, ...(editing ? { display: 'none' } : {}) }}>
                {SCOPES.filter((s) => s.v !== 'all' || supreme).map((s) => <Chip key={s.v} label={s.l} active={scope === s.v} onPress={() => setScope(s.v)} />)}
            </View>
            {!editing && scope === 'shops' ? (
                <Card onPress={() => setPicker(true)} style={{ marginTop: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Icon name="shops" size={20} color={t.primary} />
                        <Text style={{ flex: 1, color: t.text, fontWeight: '800', fontSize: font.md, marginLeft: spacing.sm }}>{shopIds.length ? `${shopIds.length} shop${shopIds.length === 1 ? '' : 's'} chosen` : 'Choose the shops'}</Text>
                        <Icon name="next" size={16} color={t.muted} />
                    </View>
                </Card>
            ) : null}
            {!editing && scope === 'brand' ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    {brands.length ? brands.map((b) => <Chip key={b.id} label={`${b.name} (${b.n})`} icon="shops" active={brandId === b.id} onPress={() => setBrandId(b.id)} />) : <Text style={{ color: t.muted }}>There is no brand yet.</Text>}
                </View>
            ) : null}

            <SectionTitle section="alerts">Starts</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {DAYS.map((d) => <Chip key={d.v} label={d.l} active={date === ymd(Date.now() + d.v * 86400000)} onPress={() => setDate(ymd(Date.now() + d.v * 86400000))} />)}
            </View>
            <View style={{ marginTop: spacing.md }}><DatePickField label="Date" value={date} onChange={setDate} title="Pick the start date" /></View>
            <TimeField label="Time (India)" value={time} onChange={setTime} title="Start time" />

            <SectionTitle section="catalog">How long</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {LENGTHS.map((l) => <Chip key={l.v} label={l.l} active={mins === l.v} onPress={() => setMins(l.v)} />)}
            </View>

            <SectionTitle section="platform">What people read</SectionTitle>
            {presets.length ? (
                <View style={{ marginBottom: spacing.md }}>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.sm }}>Tap a ready message (it is shown in every person's own language), or write your own.</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        {presets.map((m) => <Chip key={m} label={m} active={message === m} onPress={() => setMessage(message === m ? '' : m)} />)}
                    </View>
                </View>
            ) : null}
            <Field label="Message (optional)" value={message} onChangeText={setMessage} multiline maxLength={200} placeholder="We are upgrading our servers." />

            <SectionTitle section="settings">Who is warned and told</SectionTitle>
            <Hint>Customers are not messaged. They only see the maintenance badge and the grey screen.</Hint>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <Switch title="Shop owners" value={aud.owners} onValueChange={(v) => setAud((a) => ({ ...a, owners: v }))} />
                <Switch title="Cooks and waiters" value={aud.staff} onValueChange={(v) => setAud((a) => ({ ...a, staff: v }))} />
                <Switch title="Riders" value={aud.riders} onValueChange={(v) => setAud((a) => ({ ...a, riders: v }))} last />
            </Card>

            {startAt && !Number.isNaN(startAt.getTime()) ? (
                <Hint>
                    {startAt.getTime() <= Date.now() ? 'The start must be in the future.' : `${who}: everybody chosen is told now, a day before, an hour before and 15 minutes before. The apps show a banner until then. At ${show(startAt)} they pause by themselves${endAt ? ` and open again at ${show(endAt)}` : ' and stay paused until you switch it off'}.`}
                </Hint>
            ) : null}

            <Sheet visible={picker} onClose={() => setPicker(false)} title="Which shops?">
                <SearchBar value={q} onChangeText={setQ} placeholder="Shop name" />
                <SheetScroll style={{ maxHeight: 340, marginTop: spacing.sm }}>
                    {shown.map((s) => (
                        <Pressable key={s._id} onPress={() => setShopIds((a) => (a.includes(s._id) ? a.filter((x) => x !== s._id) : [...a, s._id]))} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: t.border }}>
                            <Text style={{ flex: 1, color: t.text, fontWeight: '700', fontSize: font.md }} numberOfLines={1}>{s.name}</Text>
                            {shopIds.includes(s._id) ? <Icon name="ok" size={20} color={t.primary} /> : null}
                        </Pressable>
                    ))}
                </SheetScroll>
                <Button title={`Use ${shopIds.length} shop${shopIds.length === 1 ? '' : 's'}`} onPress={() => setPicker(false)} disabled={!shopIds.length} style={{ marginTop: spacing.md }} />
            </Sheet>

            <ConfirmSheet
                visible={confirm}
                onClose={() => setConfirm(false)}
                icon="tool"
                title={editing ? 'Save the new time?' : 'Plan this maintenance?'}
                message={`${who} will pause at ${startAt ? show(startAt) : ''}. People are told right away. You can cancel it any time before it starts.`}
                confirmLabel="Plan it"
                danger
                onConfirm={save}
            />
        </Screen>
    );
}
