// Move a manager, cook, waiter or rider from one branch of a brand to another. The server refuses a person with live work.
import React, { useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTheme, spacing, font } from '../../theme';
import { Button, Chip } from '../../components/ui';
import { Sheet, SheetScroll, toast } from '../../components/feedback';
import Icon from '../../components/Icon';
import { fetchUsers } from '../../api/shopsApi';
import { movePerson } from '../../api/brandsApi';
import { errMsg } from '../../api/adminClient';

const ROLES = [['admin', 'Manager'], ['kitchen', 'Cook'], ['waiter', 'Waiter'], ['rider', 'Rider']];
const WORD = Object.fromEntries(ROLES);

export default function MovePersonSheet({ visible, onClose, brandId, branches, onDone }) {
    const t = useTheme();
    const [from, setFrom] = useState(null);
    const [people, setPeople] = useState(null);
    const [who, setWho] = useState(null);
    const [to, setTo] = useState(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => { if (visible) { setFrom(null); setPeople(null); setWho(null); setTo(null); } }, [visible]);
    // the people of the branch chosen: the four jobs that can move
    useEffect(() => {
        if (!from) return;
        setPeople(null); setWho(null);
        Promise.all(ROLES.map(([role]) => fetchUsers(from, { role, limit: 50 }).then((r) => r.items || []).catch(() => [])))
            .then((lists) => setPeople(lists.flat()));
    }, [from]);

    const go = async () => {
        setBusy(true);
        try {
            await movePerson(brandId, { fromTenantId: from, toTenantId: to, userId: who });
            toast('Moved');
            onDone && onDone();
            onClose();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    const name = (b) => (branches.find((x) => x.id === b) || {}).name || 'Branch';

    return (
        <Sheet visible={visible} onClose={onClose} title="Move a person">
            <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.sm }}>1. From which branch?</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                {branches.map((b) => <Chip key={b.id} label={b.name} active={from === b.id} onPress={() => { setFrom(b.id); setTo(null); }} />)}
            </View>
            {from ? (
                <>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginVertical: spacing.sm }}>2. Who?</Text>
                    <SheetScroll style={{ maxHeight: 220 }}>
                        {!people ? <Text style={{ color: t.muted }}>Loading...</Text> : !people.length ? <Text style={{ color: t.muted }}>No manager, cook, waiter or rider in this branch.</Text> : people.map((p) => (
                            <Pressable key={p._id || p.id} onPress={() => setWho(p._id || p.id)} style={{ paddingVertical: spacing.md, flexDirection: 'row', alignItems: 'center', borderTopWidth: 0.5, borderTopColor: t.border }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: t.text, fontWeight: '700', fontSize: font.md }}>{p.name || p.phone}</Text>
                                    <Text style={{ color: t.muted, fontSize: font.xs }}>{WORD[p.role] || p.role}{p.name ? ` · ${p.phone}` : ''}</Text>
                                </View>
                                {who === (p._id || p.id) ? <Icon name="ok" size={20} color={t.primary} /> : null}
                            </Pressable>
                        ))}
                    </SheetScroll>
                </>
            ) : null}
            {who ? (
                <>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginVertical: spacing.sm }}>3. To which branch?</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
                        {branches.filter((b) => b.id !== from).map((b) => <Chip key={b.id} label={b.name} active={to === b.id} onPress={() => setTo(b.id)} />)}
                    </View>
                </>
            ) : null}
            <Button title={to ? `Move to ${name(to)}` : 'Move'} icon="next" onPress={go} loading={busy} disabled={!from || !who || !to} style={{ marginTop: spacing.lg }} />
        </Sheet>
    );
}
