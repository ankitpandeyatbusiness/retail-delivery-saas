// Services: bulk orders, tiffin, party booking, or anything the owner makes up. Each one has the same LIVE / OFF slider as the shop.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '../../hooks/common/useLiveFocus';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../../components/common/kit';
import { useOwnerDesktop, useGridCols } from '../../utils/common/layout';
import { Frame, Hero, GlassStat } from '../../components/owners/RiderDesk';
import { PageHeader, Card, Pill, Row, SectionTitle, Empty, LiveToggle } from '../../components/owners/ui';
import { services as api, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ListShimmer } from '../../components/owners/shimmer';
import { tr } from '../../i18n';

export const priceLine = (s) => {
    const p = s.price ? `₹${s.price}` : '';
    switch (s.priceType) {
        case 'per_plate': return p ? tr('{p} per plate', { p }) : tr('Price per plate not set');
        case 'per_month': return p ? tr('{p} per month', { p }) : tr('Price per month not set');
        case 'from': return p ? tr('From {p}', { p }) : tr('Price not set');
        case 'fixed': return p || tr('Price not set');
        default: return tr('Price on request');
    }
};

export default function OwnerServicesScreen() {
    const desk = useOwnerDesktop();   // a computer: a banner, the services as cards three across, and the ways to add one as big tiles
    const gcols = useGridCols(3, 300);   // fewer, wider cards in a narrow window
    const nav = useNavigation();
    const { background, text, muted, primary, error, surface, border } = useBrand();
    const [items, setItems] = useState(null);
    const [templates, setTemplates] = useState([]);
    const [err, setErr] = useState('');
    const [busyId, setBusyId] = useState('');
    const [adding, setAdding] = useState(false);

    const load = useCallback(async () => {
        try {
            const [l, t] = await Promise.all([api.list(), api.templates()]);
            setItems(l.items || []); setTemplates(t.items || []); setErr('');
        } catch (e) { useOwnerStore.getState().noteError(e); setErr(apiError(e, 'Could not load your services.')); setItems((x) => x || []); }
    }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const flip = async (s) => {
        const on = s.isActive === false;
        setBusyId(s._id);
        try { await api.update(s._id, { isActive: on }); setItems((xs) => xs.map((x) => (x._id === s._id ? { ...x, isActive: on } : x))); }
        catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };

    // pause / resume: the service stays on the customer's list, marked "temporarily unavailable", and takes no new inquiry
    const flipPause = async (s) => {
        const on = !s.paused;
        setBusyId(s._id);
        try { await api.update(s._id, { paused: on }); setItems((xs) => xs.map((x) => (x._id === s._id ? { ...x, paused: on } : x))); showToast(on ? tr('Paused: customers see "temporarily unavailable"') : tr('Open again')); }
        catch (e) { showToast(apiError(e)); } finally { setBusyId(''); }
    };

    const add = async (kind) => {
        if (adding) return;
        nav.navigate('OwnerService', { kind });   // made only when he taps Save
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Services')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
              <Frame desk={desk}>
                {desk ? (
                    <Hero icon="briefcase" title={tr('Services')} subtitle={tr('Bulk orders, tiffin, party booking, or anything you make up. Each has its own LIVE / OFF switch.')}>
                        <View style={{ flexDirection: 'row', marginTop: 18 }}>
                            <GlassStat label={tr('Services')} value={items ? String(items.length) : '–'} icon="briefcase-outline" />
                            <GlassStat label={tr('Live')} value={items ? String(items.filter((s) => s.isActive !== false && !s.paused).length) : '–'} icon="radio-button-on" />
                            <GlassStat label={tr('Paused')} value={items ? String(items.filter((s) => s.paused).length) : '–'} icon="pause-circle-outline" />
                            <GlassStat label={tr('Questions')} value={items ? String(items.reduce((n, s) => n + (s.questions || []).filter((q) => q.enabled).length, 0)) : '–'} icon="help-circle-outline" />
                        </View>
                    </Hero>
                ) : null}
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="briefcase-outline" title={tr('No services yet')} hint={tr('Add bulk orders, tiffin or party booking below, or make your own. Customers send you inquiries.')} /> : null}
                {desk ? (
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                        {(items || []).map((s) => (
                            <View key={s._id} style={{ width: `${100 / gcols}%`, padding: 8 }}>
                                <Pressable onPress={() => nav.navigate('OwnerService', { id: String(s._id) })} style={({ hovered }) => ({ borderRadius: 22, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, padding: 18, opacity: s.isActive === false ? 0.65 : 1, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                        <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: primary + '24' }}><Ionicons name={s.icon || 'sparkles-outline'} size={26} color={primary} /></View>
                                        <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                                            <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 17 }}>{tr(s.name)}</Text>
                                            <Text numberOfLines={1} style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{priceLine(s)}{s.minGuests ? ` · ${tr('min {n} guests', { n: s.minGuests })}` : ''}</Text>
                                        </View>
                                    </View>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14 }}>
                                        <Pill label={tr('{n} questions', { n: (s.questions || []).filter((q) => q.enabled).length })} color={muted} />
                                        {s.paused ? <View style={{ marginLeft: 6 }}><Pill label={tr('Paused')} color={error} /></View> : null}
                                        <View style={{ flex: 1 }} />
                                        <LiveToggle on={s.isActive !== false} busy={busyId === s._id} onPress={() => flip(s)} />
                                    </View>
                                    {s.isActive !== false ? (
                                        <Pressable onPress={() => flipPause(s)} disabled={busyId === s._id} hitSlop={8} style={({ hovered }) => ({ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 12, height: 32, borderRadius: 16, backgroundColor: hovered ? alpha(primary, 0.14) : alpha(primary, 0.08), cursor: 'pointer' })}>
                                            <Ionicons name={s.paused ? 'play-circle-outline' : 'pause-circle-outline'} size={16} color={primary} style={{ marginRight: 5 }} />
                                            <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{s.paused ? tr('Resume') : tr('Pause')}</Text>
                                        </Pressable>
                                    ) : null}
                                </Pressable>
                            </View>
                        ))}
                    </View>
                ) : null}
                {desk ? null : (items || []).map((s) => (
                    <Card key={s._id} onPress={() => nav.navigate('OwnerService', { id: String(s._id) })} style={{ opacity: s.isActive === false ? 0.65 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: primary + '1F', marginRight: 12 }}>
                                <Ionicons name={s.icon || 'sparkles-outline'} size={21} color={primary} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16 }}>{tr(s.name)}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{priceLine(s)}{s.minGuests ? ` · ${tr('min {n} guests', { n: s.minGuests })}` : ''}</Text>
                                <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
                                    <Pill label={tr('{n} questions', { n: (s.questions || []).filter((q) => q.enabled).length })} color={muted} />
                                    {s.paused ? <View style={{ marginLeft: 6 }}><Pill label={tr('Paused')} color={error} /></View> : null}
                                </View>
                                {s.isActive !== false ? (
                                    <Pressable onPress={() => flipPause(s)} disabled={busyId === s._id} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
                                        <Ionicons name={s.paused ? 'play-circle-outline' : 'pause-circle-outline'} size={17} color={primary} style={{ marginRight: 5 }} />
                                        <Text style={{ color: primary, fontWeight: '800', fontSize: 13 }}>{s.paused ? tr('Resume') : tr('Pause')}</Text>
                                    </Pressable>
                                ) : null}
                            </View>
                            <LiveToggle on={s.isActive !== false} busy={busyId === s._id} onPress={() => flip(s)} />
                        </View>
                    </Card>
                ))}
                {desk ? (
                    <>
                        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginTop: 14, marginBottom: 6 }}>
                            <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: primary, alignItems: 'center', justifyContent: 'center', marginRight: 12 }}><Ionicons name="add" size={20} color="#FFFFFF" /></View>
                            <Text style={{ color: text, fontSize: 19, fontWeight: '900', letterSpacing: -0.3 }}>{tr('Add a service')}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: 8 }}>
                            {[...templates.map((t) => [t.kind, t.icon, tr(t.name), tr('Starts with our recommended questions')]), ['custom', 'add-circle-outline', tr('My own service'), tr('Name it and ask your own questions')]].map(([k, ic, name, sub]) => (
                                <View key={k} style={{ width: `${100 / gcols}%`, padding: 8 }}>
                                    <Pressable onPress={() => add(k)} style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 20, borderWidth: 1.5, borderStyle: 'dashed', borderColor: hovered ? primary : alpha(muted, 0.4), backgroundColor: hovered ? alpha(primary, 0.06) : 'transparent', cursor: 'pointer' })}>
                                        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center' }}><Ionicons name={ic} size={22} color={primary} /></View>
                                        <View style={{ flex: 1, minWidth: 0, marginLeft: 12 }}>
                                            <Text style={{ color: text, fontWeight: '900', fontSize: 15 }} numberOfLines={1}>{name}</Text>
                                            <Text style={{ color: muted, fontSize: 12, marginTop: 1 }} numberOfLines={2}>{sub}</Text>
                                        </View>
                                    </Pressable>
                                </View>
                            ))}
                        </View>
                    </>
                ) : null}
                {desk ? null : <SectionTitle title={tr('Add a service')} />}
                {desk ? null : <Card>
                    {templates.map((t) => (
                        <Row key={t.kind} icon={t.icon} title={tr(t.name)} subtitle={tr('Starts with our recommended questions')} onPress={() => add(t.kind)} />
                    ))}
                    <Row icon="add-circle-outline" title={tr('My own service')} subtitle={tr('Name it and ask your own questions')} onPress={() => add('custom')} last />
                </Card>}
              </Frame>
            </ScrollView>
        </View>
    );
}
