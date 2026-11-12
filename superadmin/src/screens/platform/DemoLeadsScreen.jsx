import React, { useCallback, useEffect, useState } from 'react';
import { Text, View, Linking } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Field, SearchBar, Segmented } from '../../components/inputs';
import { ErrorBox, ConfirmSheet, Empty, toast } from '../../components/feedback';
import { fetchDemoLeads, updateDemoLead, deleteDemoLead } from '../../api/platformApi';
import { errMsg } from '../../api/adminClient';
import { dateTime, ago } from '../../utils/format';

const STORY = { tour: 'Full tour', order: 'Order', follow: 'Live tracking', owner: 'Owner', cook: 'Kitchen', rider: 'Rider', waiter: 'Waiter', book: 'Bookings', points: 'Points', menu: 'Menu and team', brand: 'Brands', language: 'Languages' };
const LANG = { en: 'English', hi: 'Hindi', bho: 'Bhojpuri', mr: 'Marathi', gu: 'Gujarati', bn: 'Bengali' };

// People who tried the public demo and left their number ("Did you like the demo?"). Call them, mark them called, keep a note.
export default function DemoLeadsScreen() {
    const t = useTheme();
    const [status, setStatus] = useState('new');
    const [q, setQ] = useState('');
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const [notes, setNotes] = useState({});
    const [del, setDel] = useState(null);

    const load = useCallback(async () => {
        try { setData(await fetchDemoLeads({ ...(status === 'all' ? {} : { status }), ...(q.trim() ? { q: q.trim() } : {}) })); setError(''); } catch (e) { setError(errMsg(e)); }
    }, [status, q]);
    useEffect(() => { load(); }, [load]);

    const patch = async (id, body, ok) => {
        try { await updateDemoLead(id, body); toast(ok); await load(); } catch (e) { toast(errMsg(e), 'error'); }
    };

    return (
        <Screen title="Demo leads" subtitle={data ? `${data.new} new` : 'People who tried the demo'} onRefresh={async () => { await load(); }}>
            <Segmented options={[{ value: 'new', label: 'New' }, { value: 'called', label: 'Called' }, { value: 'all', label: 'All' }]} value={status} onChange={setStatus} />
            <View style={{ marginTop: spacing.md }}><SearchBar value={q} onChangeText={setQ} placeholder="Name, shop or number" onSubmit={load} /></View>
            {!data ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={3} avatar={false} />) : data.items.length === 0 ? (
                <Empty icon="call-outline" title={status === 'new' ? 'No new leads' : 'Nothing here'} hint="When a visitor finishes the public demo and leaves their number, they appear here and you get a notification." />
            ) : data.items.map((l) => (
                <Card key={l.id} style={{ marginTop: spacing.md }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md, flex: 1 }}>{l.name}</Text>
                        <Badge label={l.status === 'new' ? 'New' : 'Called'} tone={l.status === 'new' ? 'warn' : 'success'} />
                    </View>
                    <Text style={{ color: t.text, marginTop: 2 }}>{l.shopName}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>{l.phone} · {LANG[l.language] || l.language} · {ago(l.createdAt)}{l.times > 1 ? ` · asked ${l.times} times` : ''}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>
                        {l.stories.length ? `Watched: ${l.stories.map((s) => STORY[s] || s).join(', ')}` : 'No story finished'}
                    </Text>
                    {l.calledAt ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: 2 }}>Called {dateTime(l.calledAt)}</Text> : null}
                    <View style={{ marginTop: spacing.md }}>
                        <Field label="Note" value={notes[l.id] ?? l.note} onChangeText={(v) => setNotes((n) => ({ ...n, [l.id]: v }))} multiline maxLength={500} placeholder="What did they say?" />
                        {notes[l.id] !== undefined && notes[l.id] !== l.note ? <Button small kind="outline" title="Save note" onPress={() => patch(l.id, { note: notes[l.id] }, 'Note saved')} /> : null}
                    </View>
                    <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md }}>
                        <Button style={{ flex: 1 }} small icon="phone" title="Call" onPress={() => Linking.openURL(`tel:${l.phone}`)} />
                        <Button style={{ flex: 1 }} small kind="outline" icon="ok" title={l.status === 'new' ? 'Mark called' : 'Mark new'} onPress={() => patch(l.id, { status: l.status === 'new' ? 'called' : 'new' }, l.status === 'new' ? 'Marked called' : 'Marked new')} />
                        <Button small kind="outline" title="Delete" onPress={() => setDel(l)} />
                    </View>
                </Card>
            ))}
            <ConfirmSheet visible={!!del} onClose={() => setDel(null)} title="Delete this lead?" message="The name and number are removed for good." confirmLabel="Delete" danger
                onConfirm={async () => { try { await deleteDemoLead(del.id); toast('Deleted'); await load(); } catch (e) { toast(errMsg(e), 'error'); throw e; } }} />
        </Screen>
    );
}
