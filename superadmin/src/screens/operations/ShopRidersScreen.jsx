import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Switch, ScrollView, Linking } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen, HeaderButton } from '../../components/layout';
import { Card, Badge, Avatar, Chip, Button, Stat, SectionTitle } from '../../components/ui';
import { Segmented, Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import PersonPhoto from '../../components/PersonPhoto';
import { Empty, ErrorBox, Sheet, toast } from '../../components/feedback';
import { listRiders, addRider, updateRider, codBalances, riderPerformance, riderLocations } from '../../api/opsApi';
import { errMsg } from '../../api/adminClient';
import { rupees, ago } from '../../utils/format';

const PHONE_RE = /^[6-9]\d{9}$/;
const IST = 330 * 60000;
const ymd = (d) => new Date(d.getTime() + IST).toISOString().slice(0, 10);

const Dot = ({ on }) => {
    const t = useTheme();
    return <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: on ? t.success : t.border, marginRight: 6 }} />;
};

// Riders of one shop: who they are, the cash they hold, and how they perform.
export default function ShopRidersScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [tab, setTab] = useState('riders');
    const [riders, setRiders] = useState(null);
    const [cash, setCash] = useState(null);
    const [perf, setPerf] = useState(null);
    const [locs, setLocs] = useState([]);
    const [days, setDays] = useState(30);
    const [error, setError] = useState('');
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ phone: '', name: '' });
    const [busy, setBusy] = useState('');

    const load = useCallback(async () => {
        try {
            const [r, c, l] = await Promise.all([listRiders(shopId), codBalances(shopId), riderLocations(shopId).catch(() => ({ items: [] }))]);
            setRiders(r.items); setCash(c.items || c); setLocs(l.items || []); setError('');
        } catch (e) { setError(errMsg(e)); }
    }, [shopId]);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    useEffect(() => {
        if (tab !== 'performance') return;
        setPerf(null);
        const to = new Date();
        riderPerformance(shopId, { from: ymd(new Date(to.getTime() - (days - 1) * 86400000)), to: ymd(to) })
            .then((r) => setPerf(r.items)).catch((e) => { setPerf([]); toast(errMsg(e), 'error'); });
    }, [tab, days, shopId]);

    const toggle = async (r, v) => {
        setBusy(String(r.userId));
        try { await updateRider(shopId, String(r.userId), { isActive: v }); setRiders((cur) => cur.map((x) => (x.userId === r.userId ? { ...x, isActive: v, isOnline: v ? x.isOnline : false } : x))); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const add = async () => {
        if (!PHONE_RE.test(form.phone)) { toast('Enter a valid 10-digit number', 'error'); return; }
        setBusy('add');
        try { await addRider(shopId, { phone: form.phone, name: form.name.trim() || undefined }); toast('Rider added'); setAdding(false); setForm({ phone: '', name: '' }); await load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(''); }
    };

    const openRider = (id) => nav.navigate('RiderDetail', { shopId, name, userId: String(id) });
    const owed = (cash || []).reduce((s, x) => s + Math.max(0, x.balancePaise || 0), 0);
    const online = (riders || []).filter((r) => r.isOnline).length;

    return (
        <Screen title="Riders" subtitle={name} right={<HeaderButton icon="userAdd" onPress={() => setAdding(true)} />} refreshing={false} onRefresh={load}>
            <Segmented value={tab} onChange={setTab} options={[{ value: 'riders', label: 'Riders' }, { value: 'cash', label: 'Cash' }, { value: 'performance', label: 'Performance' }]} />

            {riders === null ? (error ? <ErrorBox message={error} onRetry={load} /> : <SkeletonList count={4} />) : tab === 'riders' ? (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                        <Stat section="riders" label="Online now" value={online} icon="rider" />
                        <Stat label="Total riders" value={riders.length} icon="users" />
                    </View>
                    {locs.length ? (
                        <>
                            <SectionTitle section="riders">On the road (last 5 minutes)</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {locs.map((p, i) => (
                                    <View key={String(p.riderId)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md, borderTopWidth: i ? 0.5 : 0, borderTopColor: t.border }}>
                                        <Dot on={p.isOnline} />
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ color: t.text, fontWeight: '700' }}>{p.name || 'Rider'}</Text>
                                            <Text style={{ color: t.muted, fontSize: font.xs }}>{p.activeOrderCount} active · seen {ago(p.at)}</Text>
                                        </View>
                                        <Button title="Map" small kind="soft" icon="pin" onPress={() => Linking.openURL(`geo:${p.lat},${p.lng}?q=${p.lat},${p.lng}`).catch(() => toast('No map app found', 'error'))} />
                                    </View>
                                ))}
                            </Card>
                        </>
                    ) : null}
                    <View style={{ height: spacing.lg }} />
                    {!riders.length ? <Empty icon="rider" title="No riders yet" hint="Add the mobile number of a delivery person." action="Add a rider" onAction={() => setAdding(true)} /> : riders.map((r) => (
                        <Card key={String(r.userId)} onPress={() => openRider(r.userId)} style={{ marginBottom: spacing.sm, opacity: r.isActive ? 1 : 0.6 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <PersonPhoto uri={r.photo} name={r.name || r.phone} />
                                <View style={{ flex: 1, marginLeft: spacing.md }}>
                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }} numberOfLines={1}>{r.name || r.phone}</Text>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                                        <Dot on={r.isOnline} />
                                        <Text style={{ color: t.muted, fontSize: font.sm }}>
                                            {r.isOnline ? 'Online' : 'Offline'} · {r.activeOrderCount} active{r.ratingCount ? ` · ★ ${Number(r.ratingAvg).toFixed(1)}` : ''}
                                        </Text>
                                    </View>
                                </View>
                                <Switch value={!!r.isActive} disabled={busy === String(r.userId)} onValueChange={(v) => toggle(r, v)} trackColor={{ true: t.success, false: t.border }} />
                            </View>
                            {r.activeOrders?.length ? (
                                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                                    {r.activeOrders.map((o) => <Badge key={String(o.id)} label={`#${o.orderNo}`} tone="info" />)}
                                </View>
                            ) : null}
                        </Card>
                    ))}
                </>
            ) : tab === 'cash' ? (
                <>
                    <View style={{ flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg }}>
                        <Stat section={owed ? 'alerts' : 'money'} label="Cash with riders" value={rupees(owed / 100)} icon="wallet" />
                    </View>
                    <SectionTitle section="money">Who holds how much</SectionTitle>
                    {!(cash || []).length ? <Empty icon="wallet" title="No cash movements yet" hint="Cash collected on delivery shows here." /> : [...cash].sort((a, b) => b.balancePaise - a.balancePaise).map((c) => (
                        <Card key={String(c.riderId)} onPress={() => openRider(c.riderId)} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ color: t.text, fontWeight: '800', fontSize: font.md }}>{c.name || 'Rider'}{c.removed ? ' (removed)' : ''}</Text>
                                    <Text style={{ color: t.muted, fontSize: font.sm }}>Collected {rupees(c.collectedPaise / 100)} · handed over {rupees(c.handedPaise / 100)}</Text>
                                    {c.lastAt ? <Text style={{ color: t.muted, fontSize: font.xs }}>Last entry {ago(c.lastAt)}</Text> : null}
                                </View>
                                <Text style={{ color: c.balancePaise > 0 ? t.danger : t.success, fontWeight: '800', fontSize: font.lg }}>{rupees(c.balancePaise / 100)}</Text>
                            </View>
                        </Card>
                    ))}
                </>
            ) : (
                <>
                    <View style={{ height: 52, marginTop: spacing.md }}>
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
                            {[7, 30, 90].map((d) => <Chip key={d} label={`${d} days`} active={days === d} onPress={() => setDays(d)} />)}
                        </ScrollView>
                    </View>
                    {perf === null ? <SkeletonList count={3} /> : !perf.length ? <Empty icon="chart" title="No deliveries in this period" /> : perf.map((p, i) => (
                        <Card key={String(p.riderId)} style={{ marginBottom: spacing.sm }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                                <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: t.primarySoft, alignItems: 'center', justifyContent: 'center' }}>
                                    <Text style={{ color: t.primary, fontWeight: '800' }}>{i + 1}</Text>
                                </View>
                                <Text style={{ flex: 1, marginLeft: spacing.md, color: t.text, fontWeight: '800', fontSize: font.md }}>{p.name}</Text>
                                <Text style={{ color: t.text, fontWeight: '800' }}>{p.deliveries} deliveries</Text>
                            </View>
                            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm }}>
                                <Badge label={p.avgDeliveryMin != null ? `${p.avgDeliveryMin} min average` : 'No timing yet'} icon="clock" />
                                <Badge label={`Cash ${rupees(p.cashCollectedPaise / 100)}`} tone="warn" />
                                {p.periodRatingAvg != null ? <Badge label={`★ ${p.periodRatingAvg} (${p.periodRatedCount})`} tone="success" /> : null}
                            </View>
                        </Card>
                    ))}
                </>
            )}

            <Sheet visible={adding} onClose={() => setAdding(false)} title="Add a rider">
                <Text style={{ color: t.muted, marginBottom: spacing.lg }}>The rider logs in to this shop's app with this number and an OTP. A number that is a shop owner cannot be a rider.</Text>
                <Field label="Mobile number" value={form.phone} onChangeText={(v) => setForm({ ...form, phone: v.replace(/\D/g, '').slice(0, 10) })} keyboardType="number-pad" autoFocus />
                <Field label="Name (optional)" value={form.name} onChangeText={(v) => setForm({ ...form, name: v })} maxLength={80} />
                <Button title="Add rider" onPress={add} loading={busy === 'add'} />
            </Sheet>
        </Screen>
    );
}
