import React, { useCallback, useMemo, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Button, Badge } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { Empty, ErrorBox, ConfirmSheet, toast } from '../../components/feedback';
import { fetchToClose, closeShop } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';
import { rupees, dateOnly } from '../../utils/format';

// Shops whose rent has been unpaid for months (the number is in Billing rules). Nothing closes by itself: you decide, one shop at a time or a whole brand.
function ShopLine({ s, onClose, last }) {
    const t = useTheme();
    return (
        <View style={{ paddingVertical: spacing.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: t.border }}>
            <Text style={{ color: t.text, fontWeight: '800' }} numberOfLines={1}>{s.name}</Text>
            <Text style={{ color: t.danger, fontWeight: '800', fontSize: font.lg, marginTop: 2 }}>{rupees(s.owed)}</Text>
            <Text style={{ color: t.muted, fontSize: font.sm }}>{s.bills} bill{s.bills === 1 ? '' : 's'} · oldest due {dateOnly(s.oldestDueAt)} · about {s.monthsLate} months late</Text>
            <Button small kind="dangerSoft" icon="lock" title="Close this shop" onPress={onClose} style={{ marginTop: spacing.sm }} />
        </View>
    );
}

export default function ShopsToCloseScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [d, setD] = useState(null);
    const [error, setError] = useState('');
    const [refreshing, setRefreshing] = useState(false);
    const [all, setAll] = useState(null);   // a brand whose branches are all to be closed: waiting for the confirm

    const load = useCallback(async () => {
        try { setD(await fetchToClose()); setError(''); } catch (e) { setError(errMsg(e)); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));
    const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

    // a brand's branches together, other shops on their own, the biggest debt first
    const rows = useMemo(() => {
        if (!d) return [];
        const brands = new Map(); const out = [];
        for (const s of d.shops) {
            if (!s.brandId) { out.push({ key: s.tenantId, shop: s, owed: s.owed }); continue; }
            if (!brands.has(s.brandId)) { const g = { key: 'b' + s.brandId, brandName: s.brandName || 'Brand', branches: [], owed: 0 }; brands.set(s.brandId, g); out.push(g); }
            const g = brands.get(s.brandId); g.branches.push(s); g.owed += s.owed;
        }
        return out.sort((a, b) => b.owed - a.owed);
    }, [d]);

    const closeOne = (s) => nav.navigate('ShopClose', { shopId: s.tenantId, name: s.name, kind: 'rent', reason: `Rent unpaid for ${s.monthsLate} months` });
    const closeAll = async () => {
        const g = all;
        let done = 0;
        for (const s of g.branches) {
            try { await closeShop(s.tenantId, { reason: `Rent unpaid for ${s.monthsLate} months`, kind: 'rent', orders: 'finish' }); done += 1; } catch (e) { toast(`${s.name}: ${errMsg(e)}`, 'error'); }
        }
        toast(`${done} of ${g.branches.length} branches closed`);
        await load();
    };

    return (
        <Screen title="Shops to close" subtitle={d ? `Rent unpaid for ${d.months} months or more` : undefined} refreshing={refreshing} onRefresh={refresh}>
            {error && !d ? <ErrorBox message={error} onRetry={load} /> : !d ? <SkeletonList count={3} /> : rows.length === 0 ? (
                <Empty icon="ok" title="No shop to close" hint={`No shop has rent unpaid for ${d.months} months. You are told here when one has. Nothing closes without your tap.`} />
            ) : rows.map((r) => (r.branches ? (
                <Card key={r.key} style={{ marginBottom: spacing.md }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Text style={{ color: t.text, fontSize: font.md, fontWeight: '800', flex: 1 }} numberOfLines={1}>{r.brandName}</Text>
                        <Badge label={`${r.branches.length} branch${r.branches.length === 1 ? '' : 'es'}`} tone="primary" icon="shops" />
                    </View>
                    <Text style={{ color: t.danger, fontSize: font.xl, fontWeight: '800', marginTop: spacing.sm }}>{rupees(r.owed)}</Text>
                    <Text style={{ color: t.muted, fontSize: font.sm, marginBottom: spacing.sm }}>Only the branches below owe. Close each one, or all of them.</Text>
                    {r.branches.map((s, i) => <ShopLine key={s.tenantId} s={s} last={i === r.branches.length - 1} onClose={() => closeOne(s)} />)}
                    {r.branches.length > 1 ? <Button kind="danger" icon="lock" title={`Close all ${r.branches.length} branches`} onPress={() => setAll(r)} style={{ marginTop: spacing.md }} /> : null}
                </Card>
            ) : (
                <Card key={r.key} style={{ marginBottom: spacing.md }}>
                    <ShopLine s={r.shop} last onClose={() => closeOne(r.shop)} />
                </Card>
            )))}
            <ConfirmSheet
                visible={!!all}
                onClose={() => setAll(null)}
                icon="lock"
                danger
                title={all ? `Close all ${all.branches.length} branches of ${all.brandName}?` : ''}
                message="Each branch closes for rent: new orders stop now and it closes when its orders are done. Each opens again by itself when its own rent is paid."
                confirmLabel="Close all"
                onConfirm={closeAll}
            />
        </Screen>
    );
}
