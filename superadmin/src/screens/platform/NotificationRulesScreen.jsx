import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useTheme, spacing, font, radius } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Chip, Button, SectionTitle } from '../../components/ui';
import { SearchBar } from '../../components/inputs';
import { MultiChoice, NumberField, Switch, Choice, Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, Sheet, SheetScroll, toast } from '../../components/feedback';
import { fetchRules, saveRule } from '../../api/platformApi';
import { useShopsStore } from '../../store/useShopsStore';
import { errMsg } from '../../api/adminClient';
import { titleCase } from '../../utils/format';

const CHANNELS = [{ value: 'inapp', label: 'In the app' }, { value: 'push', label: 'Push' }, { value: 'sms', label: 'SMS' }];
const nice = (k) => titleCase(String(k).replace(/[._]/g, ' '));
const toList = (to) => (Array.isArray(to) ? to : [to]).filter(Boolean);

// How every event is delivered: which channels, SMS escalation, or switched off. Per shop or for all shops.
export default function NotificationRulesScreen() {
    const t = useTheme();
    const shops = useShopsStore((s) => s.items);
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [q, setQ] = useState('');
    const [who, setWho] = useState('all');
    const [edit, setEdit] = useState(null);      // the event being edited
    const [scope, setScope] = useState('');      // '' = every shop, else shop id
    const [f, setF] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try { setData(await fetchRules()); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useEffect(() => { load(); }, [load]);
    useEffect(() => { if (edit && !shops.length) useShopsStore.getState().load(); }, [edit, shops.length]);

    const groups = useMemo(() => {
        if (!data) return [];
        const set = new Set();
        data.events.forEach((e) => toList(e.to).forEach((x) => set.add(x)));
        return [...set];
    }, [data]);

    const globalRule = (key) => data?.rules.find((r) => r.eventKey === key && !r.tenantId);
    const ruleFor = (key, tenantId) => data?.rules.find((r) => r.eventKey === key && String(r.tenantId || '') === String(tenantId || ''));

    // the form values for an event + scope: the saved rule on top of the default
    const open = (ev, sc = '') => {
        const r = ruleFor(ev.eventKey, sc);
        setEdit(ev); setScope(sc);
        setF({
            enabled: r?.enabled ?? true,
            channels: r?.channels ?? ev.channels ?? [],
            alsoPush: r?.alsoPush ?? !!ev.alsoPush,
            escalate: r?.escalateSmsAfterSec ?? ev.escalateSmsAfterSec ?? undefined,
        });
    };

    const save = async () => {
        setBusy(true);
        try {
            const sameChannels = JSON.stringify([...f.channels].sort()) === JSON.stringify([...(edit.channels || [])].sort());
            await saveRule({
                eventKey: edit.eventKey,
                ...(scope ? { tenantId: scope } : {}),
                enabled: f.enabled === true ? null : f.enabled,
                channels: sameChannels ? null : f.channels,
                alsoPush: f.alsoPush === !!edit.alsoPush ? null : f.alsoPush,
                escalateSmsAfterSec: (f.escalate ?? null) === (edit.escalateSmsAfterSec ?? null) ? null : (f.escalate ?? null),
            });
            toast('Rule saved'); setEdit(null); await load();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    const reset = async () => {
        setBusy(true);
        try { await saveRule({ eventKey: edit.eventKey, ...(scope ? { tenantId: scope } : {}), reset: true }); toast('Back to the default'); setEdit(null); await load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    if (!data) return <Screen title="Notification rules">{error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={4} avatar={false} />}</Screen>;

    const list = data.events
        .filter((e) => (who === 'all' || toList(e.to).includes(who)) && (!q.trim() || nice(e.eventKey).toLowerCase().includes(q.trim().toLowerCase())))
        .sort((a, b) => a.eventKey.localeCompare(b.eventKey));

    return (
        <Screen title="Notification rules" subtitle="How events are delivered" refreshing={false} onRefresh={load}>
            <SearchBar value={q} onChangeText={setQ} placeholder="Search an event" />
            <View style={{ height: 52, marginTop: spacing.sm, marginHorizontal: -spacing.lg }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.lg, alignItems: 'center' }} style={{ flexGrow: 0 }}>
                    <Chip label="Everyone" active={who === 'all'} onPress={() => setWho('all')} />
                    {groups.map((g) => <Chip key={g} label={`To ${g}`} active={who === g} onPress={() => setWho(g)} />)}
                </ScrollView>
            </View>

            {!list.length ? <Empty icon="bell" title="No events match" /> : list.map((ev) => {
                const g = globalRule(ev.eventKey);
                const shopRules = data.rules.filter((r) => r.eventKey === ev.eventKey && r.tenantId).length;
                const off = g?.enabled === false;
                return (
                    <Card key={ev.eventKey} onPress={() => open(ev, '')} style={{ marginBottom: spacing.sm, opacity: off ? 0.6 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1, paddingRight: spacing.md }}>{nice(ev.eventKey)}</Text>
                            {ev.critical ? <Badge label="Critical" tone="danger" /> : null}
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                            <Badge label={`To ${toList(ev.to).join(', ')}`} />
                            {(g?.channels ?? ev.channels ?? []).map((c) => <Badge key={c} label={CHANNELS.find((x) => x.value === c)?.label || c} tone="info" />)}
                            {off ? <Badge label="Switched off" tone="danger" /> : null}
                            {g ? <Badge label="Changed" tone="warn" icon="tune" /> : null}
                            {shopRules ? <Badge label={`${shopRules} shop rule${shopRules > 1 ? 's' : ''}`} tone="primary" /> : null}
                        </View>
                    </Card>
                );
            })}

            <Sheet visible={!!edit} onClose={() => setEdit(null)} title={edit ? nice(edit.eventKey) : ''}>
                {edit && f ? (
                    <SheetScroll style={{ maxHeight: 520 }} keyboardShouldPersistTaps="handled">
                        <Choice
                            label="Applies to"
                            options={[{ value: '', label: 'Every shop' }, ...shops.slice(0, 12).map((s) => ({ value: s._id, label: s.name }))]}
                            value={scope}
                            onChange={(v) => open(edit, v)}
                        />
                        <Switch title="Send this event" subtitle="Off = nobody is told" value={f.enabled} onValueChange={(v) => setF({ ...f, enabled: v })} />
                        <View style={{ height: spacing.md }} />
                        <MultiChoice label="Channels" options={CHANNELS} value={f.channels} onChange={(v) => setF({ ...f, channels: v })} />
                        <Switch title="Also send a push" value={f.alsoPush} onValueChange={(v) => setF({ ...f, alsoPush: v })} />
                        <View style={{ height: spacing.md }} />
                        <NumberField label="Send an SMS if not read within" suffix="seconds" integer hint="Empty = no SMS follow-up. 0 to 86400." value={f.escalate} onChange={(v) => setF({ ...f, escalate: v })} last />
                        <Hint>Only the changed values are saved; the rest keep the built-in default.</Hint>
                    </SheetScroll>
                ) : null}
                <Button title="Save rule" loading={busy} onPress={save} style={{ marginTop: spacing.md }} />
                <Button title="Back to the default" kind="outline" small onPress={reset} style={{ marginTop: spacing.sm }} disabled={busy || !ruleFor(edit?.eventKey, scope)} />
            </Sheet>
        </Screen>
    );
}
