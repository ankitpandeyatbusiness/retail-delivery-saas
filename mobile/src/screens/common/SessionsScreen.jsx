// "Where you're logged in": every phone and browser signed in as this person, with the place and time, and a Log out for each.
// The same screen for the customer, owner, cook, waiter and rider (all share one login). Ending a device signs it out at once.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, Button, Pill } from '../../components/owners/ui';
import { themedAlert } from '../../components/common/dialog';
import { showToast } from '../../components/customers/shop';
import { fetchSessions, endSession, endOtherSessions } from '../../api/common/sessionApi';
import { tr } from '../../i18n';

const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
};
const placeOf = (s) => {
    const p = [s.city, s.region].filter(Boolean).join(', ') || s.country;
    if (p) return s.country && p !== s.country && s.city ? `${p}, ${s.country}` : p;
    return s.place ? tr(s.place) : tr('Location not known');
};

export default function SessionsScreen() {
    const { background, text, muted, border, primary } = useBrand();
    const [items, setItems] = useState(null);
    const [busy, setBusy] = useState(null);   // a session id, or 'all'
    const [failed, setFailed] = useState(false);

    const load = useCallback(async () => {
        try { setItems((await fetchSessions()).items || []); setFailed(false); } catch (e) { setFailed(true); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const others = (items || []).filter((s) => !s.current);

    const endOne = (s) => themedAlert(tr('Log out this device?'), tr('{device} will be signed out at once.', { device: s.device }), [
        { text: tr('Cancel'), style: 'cancel' },
        {
            text: tr('Log out'), style: 'destructive',
            onPress: async () => {
                setBusy(s.id);
                try { await endSession(s.id); setItems((l) => (l || []).filter((x) => x.id !== s.id)); } catch (e) { showToast(tr('Could not log out. Try again.')); }
                setBusy(null);
            },
        },
    ], { icon: 'log-out-outline' });

    const endAll = () => themedAlert(tr('Log out all other devices?'), tr('Every phone and browser except this one will be signed out at once.'), [
        { text: tr('Cancel'), style: 'cancel' },
        {
            text: tr('Log out all'), style: 'destructive',
            onPress: async () => {
                setBusy('all');
                try { await endOtherSessions(); await load(); } catch (e) { showToast(tr('Could not log out. Try again.')); }
                setBusy(null);
            },
        },
    ], { icon: 'log-out-outline' });

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr("Where you're logged in")} />
            <ScrollView contentContainerStyle={{ paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
                <Text style={{ color: muted, fontSize: 12.5, lineHeight: 18, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
                    {tr('These phones and browsers are signed in with your number. If you see one you do not know, log it out. The place is a guess from the internet address, so it can be a nearby city.')}
                </Text>

                {items === null && !failed ? <ActivityIndicator style={{ marginTop: 30 }} color={primary} /> : null}
                {failed && items === null ? (
                    <View style={{ padding: 16 }}>
                        <Text style={{ color: muted, marginBottom: 10 }}>{tr('Could not load. Check your internet.')}</Text>
                        <Button label={tr('Try again')} kind="ghost" onPress={load} />
                    </View>
                ) : null}

                {(items || []).map((s) => (
                    <Card key={s.id} style={{ marginHorizontal: 16, marginBottom: 10 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'flex-start', padding: 14 }}>
                            <Ionicons name={s.platform === 'web' ? 'globe-outline' : 'phone-portrait-outline'} size={26} color={text} style={{ marginRight: 12, marginTop: 2 }} />
                            <View style={{ flex: 1 }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <Text style={{ color: text, fontWeight: '800', fontSize: 15, marginRight: 8 }}>{s.device}</Text>
                                    {s.current ? <Pill label={tr('This device')} /> : null}
                                </View>
                                <Text style={{ color: muted, marginTop: 3 }}>{placeOf(s)}</Text>
                                <Text style={{ color: muted, marginTop: 2, fontSize: 12.5 }}>{tr('Logged in {when}', { when: when(s.loggedInAt) })}</Text>
                                <Text style={{ color: muted, marginTop: 1, fontSize: 12.5 }}>{tr('Last active {when}', { when: when(s.lastActiveAt) })}</Text>
                            </View>
                            {!s.current ? (
                                <Pressable onPress={() => endOne(s)} disabled={!!busy} hitSlop={8} style={{ paddingVertical: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: border, borderRadius: 10, opacity: busy ? 0.5 : 1 }}>
                                    {busy === s.id ? <ActivityIndicator size="small" color={primary} /> : <Text style={{ color: text, fontWeight: '700' }}>{tr('Log out')}</Text>}
                                </Pressable>
                            ) : null}
                        </View>
                    </Card>
                ))}

                {others.length > 0 ? (
                    <View style={{ paddingHorizontal: 16, marginTop: 6 }}>
                        <Button label={tr('Log out all other devices')} kind="danger" icon="log-out-outline" onPress={endAll} busy={busy === 'all'} disabled={!!busy} />
                    </View>
                ) : null}
                {items && items.length <= 1 ? (
                    <Text style={{ color: muted, textAlign: 'center', marginTop: 14, fontSize: 13 }}>{tr('You are logged in on this device only.')}</Text>
                ) : null}
            </ScrollView>
        </View>
    );
}
