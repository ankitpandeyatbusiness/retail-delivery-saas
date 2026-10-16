import React, { useCallback, useState } from 'react';
import { View, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, Badge, Button, ListRow, SectionTitle } from '../../components/ui';
import { Field } from '../../components/inputs';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, Sheet, toast } from '../../components/feedback';
import { useSupreme } from '../../hooks/useSupreme';
import { fetchOperators, saveLiveAsOperator } from '../../api/operatorsApi';
import { errMsg } from '../../api/adminClient';

const when = (d) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });

// The companies that can run the platform. One is active: its name, GST number and Razorpay account are on every new bill and
// payment. The supreme admin keeps both companies here and presses "Switch" when the time comes.
export default function OperatorsScreen() {
    const t = useTheme();
    const nav = useNavigation();
    const supreme = useSupreme();
    const [r, setR] = useState(null);
    const [err, setErr] = useState('');
    const [saveOpen, setSaveOpen] = useState(false);
    const [label, setLabel] = useState('');
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => { setErr(''); try { setR(await fetchOperators()); } catch (e) { setErr(errMsg(e)); } }, []);
    useFocusEffect(useCallback(() => { load(); }, [load]));

    const saveLive = async () => {
        setBusy(true);
        try { await saveLiveAsOperator(label.trim() || undefined); toast('Saved'); setSaveOpen(false); load(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <Screen title="Companies" subtitle="Who runs the platform now, and who runs it next" onRefresh={load}>
            {!r && !err ? <SkeletonList /> : null}
            {err ? <ErrorBox message={err} onRetry={load} /> : null}
            {r ? (
                <>
                    {!r.items.length ? (
                        <Card>
                            <Text style={{ color: t.text, fontWeight: '800' }}>Start by saving the company that runs the platform now</Text>
                            <Text style={{ color: t.muted, marginTop: 4 }}>It keeps its details and Razorpay keys here, so nothing is lost when you switch to another company later. Fill Money, Business details and the Razorpay keys first.</Text>
                            {supreme ? <View style={{ marginTop: spacing.md }}><Button title="Save the current company" icon="check" onPress={() => setSaveOpen(true)} /></View> : null}
                        </Card>
                    ) : (
                        <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                            {r.items.map((o, i) => (
                                <ListRow
                                    key={o.id} section="platform" icon="bank" title={o.label}
                                    subtitle={[o.business.legalName, o.business.gstin ? `GSTIN ${o.business.gstin}` : 'no GST number', o.hasKeys ? 'Razorpay keys saved' : 'no Razorpay keys'].filter(Boolean).join(' · ')}
                                    right={o.active ? <Badge label="Active" tone="success" /> : (o.settlementMode === 'owner_only' ? <Badge label="All yours" tone="info" /> : null)}
                                    onPress={() => nav.navigate('OperatorEdit', { id: o.id })} last={i === r.items.length - 1}
                                />
                            ))}
                        </Card>
                    )}
                    {supreme && r.items.length ? (
                        <View style={{ marginTop: spacing.md }}>
                            <Button title="Add a company" icon="add" kind="soft" onPress={() => nav.navigate('OperatorEdit', {})} />
                        </View>
                    ) : null}
                    {!supreme ? <Text style={{ color: t.muted, fontSize: font.sm, marginTop: spacing.md }}>You can look at this. Only the supreme admin changes it.</Text> : null}

                    {r.history.length ? (
                        <>
                            <SectionTitle section="orders">Switches so far</SectionTitle>
                            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                                {r.history.map((h, i) => <ListRow key={h.id} section="orders" icon="clock" title={`${h.from || 'Nobody'} → ${h.to}`} subtitle={`${when(h.at)} · ${h.by}${h.note ? ` · ${h.note}` : ''}`} last={i === r.history.length - 1} />)}
                            </Card>
                        </>
                    ) : null}
                    <Sheet visible={saveOpen} onClose={() => setSaveOpen(false)} title="Save the current company">
                        <Field label="A short name for it" value={label} onChangeText={setLabel} maxLength={80} placeholder="e.g. Partner company" />
                        <Button title="Save" icon="check" onPress={saveLive} loading={busy} />
                    </Sheet>
                </>
            ) : null}
        </Screen>
    );
}
