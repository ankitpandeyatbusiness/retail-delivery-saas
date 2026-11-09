import React, { useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme, spacing, font } from '../../theme';
import { Card, Button, SectionTitle, Badge } from '../../components/ui';
import { Field } from '../../components/inputs';
import { Sheet, toast } from '../../components/feedback';
import { planLine } from '../../components/shopBits';
import { setBrandLocations, syncBrandPlan } from '../../api/brandsApi';
import { errMsg } from '../../api/adminClient';

const rs = (paise) => `Rs ${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`;

// A brand has ONE plan, set on its main shop; the branches follow. Here: the plan and end date, how many shops the brand has and may have (3 are free by default,
// editable for this brand), the extra shops it paid for, the free extras you allow. Only the supreme admin can change the numbers (the server refuses everybody else).
export default function BrandPlanCard({ brandId, plan, onChanged, canEdit }) {
    const t = useTheme();
    const nav = useNavigation();
    const [open, setOpen] = useState(false);
    const [free, setFree] = useState('');
    const [freeExtra, setFreeExtra] = useState('');
    const [busy, setBusy] = useState(false);
    if (!plan) return null;
    const L = plan.locations;

    const openSheet = () => { setFree(String(L.includedBranches)); setFreeExtra(String(L.freeExtra)); setOpen(true); };
    const save = async (clear) => {
        setBusy(true);
        try {
            await setBrandLocations(brandId, { includedBranches: clear ? null : Number(free), freeExtra: Number(freeExtra || 0) });
            toast('Saved');
            setOpen(false);
            onChanged && onChanged();
        } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };

    return (
        <>
            <SectionTitle section="money">Plan and shops</SectionTitle>
            <Card>
                <Text style={{ color: t.text, fontWeight: '800', fontSize: font.lg }}>{plan.plan?.id ? planLine(plan.plan) : 'No plan yet'}</Text>
                <Text style={{ color: t.muted, marginTop: spacing.xs }}>One plan for the whole brand, set on the main shop{plan.main ? ` (${plan.main.name})` : ''}. The branches follow it.</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md }}>
                    <Badge label={`${L.used} of ${L.capacity} shops used`} tone={L.used >= L.capacity ? 'warn' : 'success'} />
                    <Badge label={`${L.includedLocations} free`} tone="info" />
                    {L.paidExtra ? <Badge label={`${L.paidExtra} extra paid`} tone="primary" /> : null}
                    {L.freeExtra ? <Badge label={`${L.freeExtra} extra free (yours)`} tone="neutral" /> : null}
                </View>
                <Text style={{ color: t.muted, marginTop: spacing.sm, fontSize: font.sm }}>Each extra shop: {rs(L.addonPaise)} a month + GST, paid by the brand owner before the shop is created.</Text>
                {plan.main ? <Button title="Open the plan of the main shop" kind="soft" icon="star" small onPress={() => nav.navigate('ShopPlan', { shopId: plan.main.id, name: plan.main.name })} style={{ marginTop: spacing.md }} /> : null}
                {plan.differing?.length ? (
                    <View style={{ marginTop: spacing.md }}>
                        <Text style={{ color: t.danger, fontSize: font.sm }}>{plan.differing.length} branch{plan.differing.length === 1 ? ' has' : 'es have'} a plan of its own: {plan.differing.map((d) => `${d.name} (${d.plan || 'none'})`).join(', ')}.</Text>
                        {canEdit ? <Button title="Make every branch follow the main plan" kind="dangerSoft" small onPress={async () => { try { await syncBrandPlan(brandId); toast('Branches now follow the main plan'); onChanged && onChanged(); } catch (e) { toast(errMsg(e), 'error'); } }} style={{ marginTop: spacing.sm }} /> : null}
                    </View>
                ) : null}
                {canEdit ? <Button title="Free shops and free extras" kind="outline" small onPress={openSheet} style={{ marginTop: spacing.sm }} /> : null}
            </Card>

            <Sheet visible={open} onClose={() => setOpen(false)} title="Shops for this brand">
                <Text style={{ color: t.muted, marginBottom: spacing.md }}>Free branches besides the main shop. The platform default is shown in More > Plan defaults. A free extra is one more shop you allow without payment. It is written to the audit log.</Text>
                <Field label="Free branches besides the main shop" value={free} onChangeText={(v) => setFree(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
                <Field label="Extra shops you allow free" value={freeExtra} onChangeText={(v) => setFreeExtra(v.replace(/\D/g, '').slice(0, 2))} keyboardType="number-pad" />
                <Button title="Save" loading={busy} onPress={() => save(false)} style={{ marginTop: spacing.md }} />
                <Button title="Use the platform default for the free branches" kind="outline" small loading={busy} onPress={() => save(true)} style={{ marginTop: spacing.sm }} />
            </Sheet>
        </>
    );
}
