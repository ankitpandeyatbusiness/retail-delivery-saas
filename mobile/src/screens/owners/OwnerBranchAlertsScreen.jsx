// Alerts by branch (brand owner only): which branches may ring his phone.
//   - the branch he manages himself always does
//   - the branch the app is open on does
//   - every other branch is off until he switches it on, or turns on "every branch"
// A few serious alerts (a rider's SOS, an order nobody accepted, rent trouble) come through from any branch.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, Switch, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
import { PageHeader, Card, SectionTitle, Empty } from '../../components/owners/ui';
import { showToast } from '../../components/customers/shop';
import { fetchNotifyPrefs, saveNotifyPrefs } from '../../api/owners/brandApi';
import { apiError } from '../../api/owners/shopApi';
import { tr } from '../../i18n';
import { useOwnerDesktop } from '../../utils/common/layout';
import { Hero } from '../../components/owners/RiderDesk';

export default function OwnerBranchAlertsScreen() {
    const { background, text, muted, primary, border } = useBrand();
    const desk = useOwnerDesktop();   // a computer: a banner, the main switch on the left and the branches on the right
    const [v, setV] = useState(null);
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        setErr('');
        try { setV(await fetchNotifyPrefs()); } catch (e) { setErr(apiError(e, tr('Could not load.'))); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const save = async (body) => {
        setBusy(true);
        try {
            const r = await saveNotifyPrefs(body);
            setV(r);
            if (r.warnings && r.warnings.length) showToast(r.warnings[0]);
        } catch (e) { showToast(apiError(e, tr('Could not save.'))); } finally { setBusy(false); }
    };

    if (err) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Alerts by branch')} /><Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /></View>;
    if (!v) return <View style={{ flex: 1, backgroundColor: background }}><PageHeader title={tr('Alerts by branch')} /></View>;

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Alerts by branch')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <View style={desk ? { width: '100%', maxWidth: 1100, alignSelf: 'center' } : undefined}>
                {desk ? <Hero icon="notifications" title={tr('Alerts by branch')} subtitle={tr('Choose which branches may ring your phone.')} /> : null}
                <View style={desk ? { flexDirection: 'row', alignItems: 'flex-start' } : undefined}>
                <View style={desk ? { width: 360, flexShrink: 0 } : undefined}>
                <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr('Alerts from every branch')}</Text>
                            <Text style={{ color: muted, marginTop: 2, fontSize: 13 }}>{tr('Off: you hear only the branches chosen below.')}</Text>
                        </View>
                        <Switch value={v.all} disabled={busy} onValueChange={(on) => save({ all: on })} trackColor={{ true: primary }} />
                    </View>
                </Card>
                <Text style={{ color: muted, fontSize: 12, marginHorizontal: 18, marginTop: 8, display: desk ? 'flex' : 'none' }}>
                    {tr('A rider SOS, an order nobody accepted and rent trouble reach you from every branch.')}
                </Text>
                </View>
                <View style={desk ? { flex: 1, minWidth: 0 } : undefined}>
                <SectionTitle title={tr('Branches')} />
                <Card>
                    {v.branches.map((b, i) => (
                        <View key={b.slug} style={{ paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: border }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ flex: 1, paddingRight: 10 }}>
                                    <Text style={{ color: text, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{b.name}</Text>
                                    <Text style={{ color: muted, fontSize: 12, marginTop: 1 }}>
                                        {[b.city, b.own ? tr('You manage this branch') : null, b.open ? tr('Open now') : null].filter(Boolean).join(' · ')}
                                    </Text>
                                </View>
                                <Switch
                                    value={b.on} disabled={busy || v.all}
                                    onValueChange={(on) => save({ branches: { [b.slug]: on } })}
                                    trackColor={{ true: primary }}
                                />
                            </View>
                            <Pressable
                                onPress={() => save({ ownSlug: b.own ? null : b.slug })} disabled={busy}
                                style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }} accessibilityRole="button"
                            >
                                <Ionicons name={b.own ? 'checkbox' : 'square-outline'} size={20} color={b.own ? primary : muted} />
                                <Text style={{ color: b.own ? primary : muted, fontWeight: '700', marginLeft: 8, fontSize: 13 }}>{tr('I manage this branch myself')}</Text>
                            </Pressable>
                        </View>
                    ))}
                </Card>
                <Text style={{ color: muted, fontSize: 12, marginHorizontal: 18, marginTop: 8, display: desk ? 'none' : 'flex' }}>
                    {tr('A rider SOS, an order nobody accepted and rent trouble reach you from every branch.')}
                </Text>
                </View>
                </View>
              </View>
            </ScrollView>
        </View>
    );
}
