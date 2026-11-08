import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, ListRow } from '../../components/ui';
import { BroughtByCard } from '../../components/broughtByBits';
import MakeBrandCard from '../../components/makeBrandCard';
import { SkeletonList } from '../../components/blocks';
import { useShopStore } from '../../store/useShopStore';
import { folderOf } from './shopFolders';

// One folder of a shop: the rows with a plain one-line description each. (The shop page lists the folders.)
export default function ShopFolderScreen() {
    const nav = useNavigation();
    const { shopId, name, folder } = useRoute().params;
    const f = folderOf(folder);
    const rec = useShopStore((s) => s.byId[shopId]);
    const [refreshing, setRefreshing] = useState(false);
    useFocusEffect(useCallback(() => { if (!useShopStore.getState().byId[shopId]) useShopStore.getState().load(shopId); }, [shopId]));
    const refresh = async () => { setRefreshing(true); await useShopStore.getState().load(shopId, { quiet: true }); setRefreshing(false); };
    if (!f) return <Screen title="Shop" subtitle={name}><SkeletonList count={3} /></Screen>;

    const tenant = rec?.tenant;
    const closed = tenant ? tenant.status !== 'active' : false;
    const open = (r) => nav.navigate(r.screen, r.byTenantId ? { tenantId: shopId, name } : { shopId, name });
    return (
        <Screen title={f.title} subtitle={name} refreshing={refreshing} onRefresh={refresh}>
            {f.cards && tenant ? (
                <>
                    <BroughtByCard shopId={shopId} current={tenant.broughtBy} onChanged={refresh} />
                    <MakeBrandCard tenant={tenant} onDone={refresh} />
                </>
            ) : null}
            <Card padded={false} style={{ paddingHorizontal: spacing.lg, marginTop: f.cards ? spacing.md : 0 }}>
                {f.rows.map((r, i) => (
                    <ListRow
                        key={r.screen}
                        section={r.section}
                        icon={r.icon}
                        danger={r.closeRow && closed}
                        title={r.closeRow && closed ? 'Open this shop again' : r.title}
                        subtitle={r.closeRow && closed ? 'It is closed now: see why, and open it' : r.subtitle}
                        onPress={() => open(r)}
                        last={i === f.rows.length - 1}
                    />
                ))}
            </Card>
        </Screen>
    );
}
