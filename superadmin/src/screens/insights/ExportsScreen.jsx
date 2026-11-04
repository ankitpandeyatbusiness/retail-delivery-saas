import React, { useCallback, useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, ListRow } from '../../components/ui';
import { Hint } from '../../components/settingsForm';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox } from '../../components/feedback';
import Icon from '../../components/Icon';
import { fetchExportCatalog, loadPresets, savePresets } from '../../api/exportApi';
import { errMsg } from '../../api/adminClient';

const ICON = { customers: 'users', owners: 'crown', brand_people: 'shops', staff: 'user', orders: 'orders', invoices: 'receipt', payments: 'wallet', refunds: 'rupee', complaints: 'message', riders: 'rider', menu: 'notes', shops: 'shops', sms_topups: 'wallet', sms_sent: 'message', expenses: 'wallet', audit: 'notes' };
const SECTION = { People: 'people', 'Orders and money': 'money', SMS: 'catalog', 'Shop data': 'shops', Platform: 'platform' };

// The Export centre: pick what, then (on the next screen) the shops, the period, how much detail and the filters.
// Saved choices ("Last month orders for my CA") are kept on this phone and open the same screen already filled in.
export default function ExportsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const [cat, setCat] = useState(null);
    const [error, setError] = useState('');
    const [presets, setPresets] = useState([]);

    const load = useCallback(async () => {
        try { setCat(await fetchExportCatalog()); setError(''); } catch (e) { setError(errMsg(e)); }
        setPresets(await loadPresets());
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const remove = async (id) => { const next = presets.filter((p) => p.id !== id); setPresets(next); await savePresets(next); };
    const groups = cat ? [...new Set(cat.items.map((i) => i.group))] : [];

    return (
        <Screen title="Export data" subtitle="Excel or CSV, as much detail as you need" onRefresh={load}>
            {!cat ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList />) : (
                <>
                    {presets.length ? (
                        <>
                            <SectionTitle section="money">Your saved choices</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {presets.map((p, i) => (
                                    <ListRow
                                        key={p.id}
                                        section="money"
                                        icon="bolt"
                                        title={p.name}
                                        subtitle={`${cat.items.find((x) => x.key === p.key)?.title || p.key} · ${p.level}`}
                                        right={<Pressable onPress={() => remove(p.id)} hitSlop={10}><Icon name="trash" size={18} color={t.muted} /></Pressable>}
                                        onPress={() => nav.navigate('ExportBuild', { key: p.key, preset: p })}
                                        last={i === presets.length - 1}
                                    />
                                ))}
                            </Card>
                        </>
                    ) : null}

                    {groups.map((g) => (
                        <View key={g}>
                            <SectionTitle section={SECTION[g] || 'platform'}>{g}</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {cat.items.filter((i) => i.group === g).map((i, idx, arr) => (
                                    <ListRow key={i.key} section={SECTION[g] || 'platform'} icon={ICON[i.key] || 'copy'} title={i.title} subtitle={i.hint} onPress={() => nav.navigate('ExportBuild', { key: i.key })} last={idx === arr.length - 1} />
                                ))}
                            </Card>
                        </View>
                    ))}
                    <Hint>Every file starts with a Summary sheet that says what you chose. Up to {cat.max.toLocaleString('en-IN')} rows per file; if more match, narrow the period or the shops. Phone numbers are hidden in the middle, only the supreme admin can export full ones and every such download is logged.</Hint>
                </>
            )}
        </Screen>
    );
}
