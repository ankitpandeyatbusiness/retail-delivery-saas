// "Download your data": Excel or CSV files of the shop (or all the branches, for a brand owner): customers, cooks and waiters, riders, orders, rent bills, complaints, menu, shops and branches.
// This is the list; the next screen (OwnerExportBuild) sets the period, the detail and the filters of one file.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBrand } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Row } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchExportCatalog, apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';
import { UpgradeNote } from '../../components/owners/PlanLock';

const ICON = { customers: 'people', staff: 'restaurant', riders: 'bicycle', orders: 'receipt', invoices: 'document-text', complaints: 'chatbubble-ellipses', menu: 'list', branches: 'storefront' };

export default function OwnerExportScreen() {
    const nav = useNavigation();
    const { muted, error: red } = useBrand();
    const [cat, setCat] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => { fetchExportCatalog().then((r) => { setCat(r); setErr(''); }).catch((e) => setErr(apiError(e))); }, []);
    useEffect(() => { load(); }, [load]);

    const groups = cat ? [...new Set(cat.items.map((i) => i.group))] : [];
    return (
        <OwnerScreen title={tr('Download your data')} page onRefresh={load}>
            <View style={{ padding: 16 }}>
                <Text style={{ color: muted, fontSize: 13, marginBottom: 4 }}>{tr('Excel or CSV files of your own shop. Pick one, choose how much detail you want, and download.')}</Text>
                <UpgradeNote feature="fullExports" text={tr('Files below Pro leave out customer names, phones and addresses')} style={{ marginHorizontal: 0 }} />
                {!cat ? (err ? <Text style={{ color: red, marginTop: 12 }}>{err}</Text> : <ListShimmer />) : groups.map((g) => (
                    <View key={g}>
                        <SectionTitle title={tr(g)} />
                        <Card style={{ paddingHorizontal: 12 }}>
                            {cat.items.filter((i) => i.group === g).map((i, idx, arr) => (
                                <Row key={i.key} icon={ICON[i.key] || 'download'} title={tr(i.title)} subtitle={tr(i.hint)} onPress={() => nav.navigate('OwnerExportBuild', { key: i.key })} last={idx === arr.length - 1} />
                            ))}
                        </Card>
                    </View>
                ))}
            </View>
        </OwnerScreen>
    );
}
