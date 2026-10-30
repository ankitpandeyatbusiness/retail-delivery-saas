// Services: bulk orders, tiffin, party booking, or anything the owner makes up. Each one has the same LIVE / OFF slider as the shop.
import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand } from '../../components/common/kit';
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
        default: return tr('On quote');
    }
};

export default function OwnerServicesScreen() {
    const nav = useNavigation();
    const { background, text, muted, primary } = useBrand();
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

    const add = async (kind) => {
        if (adding) return;
        nav.navigate('OwnerService', { kind });   // made only when he taps Save
    };

    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr('Services')} />
            <ScrollView contentContainerStyle={{ paddingTop: 6, paddingBottom: 32 }}>
                {items === null ? <ListShimmer /> : null}
                {err && !items?.length ? <Empty icon="cloud-offline-outline" title={tr('Could not load')} hint={err} /> : null}
                {items && !items.length && !err ? <Empty icon="briefcase-outline" title={tr('No services yet')} hint={tr('Add bulk orders, tiffin or party booking below, or make your own. Customers send you inquiries.')} /> : null}
                {(items || []).map((s) => (
                    <Card key={s._id} onPress={() => nav.navigate('OwnerService', { id: String(s._id) })} style={{ opacity: s.isActive === false ? 0.65 : 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                            <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: primary + '1F', marginRight: 12 }}>
                                <Ionicons name={s.icon || 'sparkles-outline'} size={21} color={primary} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                                <Text numberOfLines={1} style={{ color: text, fontWeight: '900', fontSize: 16 }}>{s.name}</Text>
                                <Text style={{ color: muted, fontSize: 12, marginTop: 2 }}>{priceLine(s)}{s.minGuests ? ` · ${tr('min {n} guests', { n: s.minGuests })}` : ''}</Text>
                                <View style={{ flexDirection: 'row', marginTop: 6 }}>
                                    <Pill label={tr('{n} questions', { n: (s.questions || []).filter((q) => q.enabled).length })} color={muted} />
                                </View>
                            </View>
                            <LiveToggle on={s.isActive !== false} busy={busyId === s._id} onPress={() => flip(s)} />
                        </View>
                    </Card>
                ))}
                <SectionTitle title={tr('Add a service')} />
                <Card>
                    {templates.map((t) => (
                        <Row key={t.kind} icon={t.icon} title={t.name} subtitle={tr('Starts with our recommended questions')} onPress={() => add(t.kind)} />
                    ))}
                    <Row icon="add-circle-outline" title={tr('My own service')} subtitle={tr('Name it and ask your own questions')} onPress={() => add('custom')} last />
                </Card>
            </ScrollView>
        </View>
    );
}
