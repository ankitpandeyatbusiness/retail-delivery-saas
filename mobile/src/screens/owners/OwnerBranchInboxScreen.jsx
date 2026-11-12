// Notifications of every branch together (brand owner only). Each row names its branch. A row greyed "silent" is from a branch he turned off:
// it is here to read, but it did not ring his phone. Filter by branch with the chips.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Chips, Empty } from '../../components/owners/ui';
import { fetchBrandInbox } from '../../api/owners/brandApi';
import { useBrandStore } from '../../store/owners/useBrandStore';
import { apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';
import { useOwnerDesktop } from '../../utils/common/layout';

const when = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function OwnerBranchInboxScreen() {
    const desk = useOwnerDesktop();   // a computer keeps what is on screen while the new list loads
    const nav = useNavigation();
    const { background, text, muted, primary, border, surface } = useBrand();
    const me = useBrandStore((s) => s.me);
    const [branch, setBranch] = useState('all');
    const [rows, setRows] = useState(null);
    const [more, setMore] = useState(false);
    const [page, setPage] = useState(1);
    const [err, setErr] = useState('');

    useEffect(() => { useBrandStore.getState().load(); }, []);
    const load = useCallback(async (p = 1) => {
        if (p === 1 && !desk) setRows(null);
        setErr('');
        try {
            const r = await fetchBrandInbox({ page: p, ...(branch === 'all' ? {} : { branch }) });
            setRows((cur) => (p === 1 ? r.items : [...(cur || []), ...r.items]));
            setMore(r.hasMore); setPage(p);
        } catch (e) { setErr(apiError(e, tr('Could not load.'))); }
    }, [branch]);
    useEffect(() => { load(1); }, [load]);

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Notifications of all branches')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                <View style={{ paddingHorizontal: 16 }}>
                    <Chips options={[['all', tr('All branches')], ...((me && me.branches) || []).map((b) => [b.slug, b.name])]} value={branch} onChange={setBranch} />
                    <Pressable onPress={() => nav.navigate('OwnerBranchAlerts')} style={{ marginTop: 10 }} accessibilityRole="button">
                        <Text style={{ color: primary, fontWeight: '800' }}>{tr('Choose which branches ring my phone')}</Text>
                    </Pressable>
                </View>
                {err ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {rows && !rows.length ? <Empty icon="notifications-off-outline" title={tr('No notifications yet')} /> : null}
                {(rows || []).map((n) => (
                    <View key={n.id} style={{ marginHorizontal: 16, marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: surface, borderWidth: 1, borderColor: border, opacity: n.silent ? 0.62 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <Text style={{ color: primary, fontWeight: '900', fontSize: 12, flex: 1 }} numberOfLines={1}>{n.branch ? n.branch.name : ''}</Text>
                            {n.silent ? <Text style={{ color: muted, fontSize: 11, fontWeight: '800' }}>{tr('Silent')}</Text> : null}
                        </View>
                        <Text style={{ color: text, fontWeight: n.read ? '600' : '900', marginTop: 2 }}>{n.title}</Text>
                        {n.body ? <Text style={{ color: muted, marginTop: 2 }}>{n.body}</Text> : null}
                        <Text style={{ color: muted, fontSize: 11, marginTop: 4 }}>{when(n.createdAt)}</Text>
                    </View>
                ))}
                {more ? (
                    <Pressable onPress={() => load(page + 1)} style={{ alignSelf: 'center', padding: 14 }} accessibilityRole="button">
                        <Text style={{ color: primary, fontWeight: '900' }}>{tr('Show more')}</Text>
                    </Pressable>
                ) : null}
            </ScrollView>
        </View>
    );
}
