// "Download your data": Excel or CSV files of the shop (or all the branches, for a brand owner): customers, cooks and waiters, riders, orders, rent bills, complaints, menu, shops and branches.
// This is the list; the next screen (OwnerExportBuild) sets the period, the detail and the filters of one file.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Hero } from '../../components/owners/RiderDesk';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../../components/common/kit';
import { OwnerScreen, Card, SectionTitle, Row } from '../../components/owners/ui';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchExportCatalog, apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';
import { UpgradeNote } from '../../components/owners/PlanLock';

const ICON = { customers: 'people', staff: 'restaurant', riders: 'bicycle', orders: 'receipt', invoices: 'document-text', complaints: 'chatbubble-ellipses', menu: 'list', branches: 'storefront' };

export default function OwnerExportScreen() {
    const nav = useNavigation();
    const { muted, error: red, text, primary, border, surface } = useBrand();
    const desk = useOwnerDesktop();
    const gcols = useGridCols(3, 320);
    const [cat, setCat] = useState(null);
    const [err, setErr] = useState('');
    const load = useCallback(() => { fetchExportCatalog().then((r) => { setCat(r); setErr(''); }).catch((e) => setErr(apiError(e))); }, []);
    useEffect(() => { load(); }, [load]);

    const groups = cat ? [...new Set(cat.items.map((i) => i.group))] : [];
    return (
        <OwnerScreen title={tr('Download your data')} page onRefresh={load} wide={desk}>
            {desk ? <Hero icon="download" title={tr('Download your data')} subtitle={tr('Excel or CSV files of your own shop. Pick one, choose how much detail you want, and download.')} /> : null}
            <View style={{ padding: 16 }}>
                {desk ? null : <Text style={{ color: muted, fontSize: 13, marginBottom: 4 }}>{tr('Excel or CSV files of your own shop. Pick one, choose how much detail you want, and download.')}</Text>}
                <UpgradeNote feature="fullExports" text={tr('Files below Pro leave out customer names, phones and addresses')} style={{ marginHorizontal: 0 }} />
                {!cat ? (err ? <Text style={{ color: red, marginTop: 12 }}>{err}</Text> : <ListShimmer />) : groups.map((g) => (
                    <View key={g}>
                        <SectionTitle title={tr(g)} />
                        {desk ? (
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', margin: -8 }}>
                                {cat.items.filter((i) => i.group === g).map((i) => (
                                    <View key={i.key} style={{ width: `${100 / gcols}%`, padding: 8 }}>
                                        <Pressable onPress={() => nav.navigate('OwnerExportBuild', { key: i.key })} accessibilityRole="button" style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', padding: 16, minHeight: 92, borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', cursor: 'pointer', transitionProperty: 'background-color, box-shadow, border-color', transitionDuration: '140ms' })}>
                                            <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ICON[i.key] || 'download'} size={24} color={primary} /></View>
                                            <View style={{ flex: 1, minWidth: 0, marginHorizontal: 14 }}>
                                                <Text style={{ color: text, fontWeight: '900', fontSize: 15.5 }} numberOfLines={1}>{tr(i.title)}</Text>
                                                <Text style={{ color: muted, fontSize: 12.5, marginTop: 3 }} numberOfLines={2}>{tr(i.hint)}</Text>
                                            </View>
                                            <Ionicons name="chevron-forward" size={18} color={muted} />
                                        </Pressable>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        {desk ? null : <Card style={{ paddingHorizontal: 12 }}>
                            {cat.items.filter((i) => i.group === g).map((i, idx, arr) => (
                                <Row key={i.key} icon={ICON[i.key] || 'download'} title={tr(i.title)} subtitle={tr(i.hint)} onPress={() => nav.navigate('OwnerExportBuild', { key: i.key })} last={idx === arr.length - 1} />
                            ))}
                        </Card>}
                    </View>
                ))}
            </View>
        </OwnerScreen>
    );
}
