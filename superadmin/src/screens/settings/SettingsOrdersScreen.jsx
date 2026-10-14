import React from 'react';
import { View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, MultiChoice, NumberField, Switch, Hint } from '../../components/settingsForm';
import { Button } from '../../components/ui';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices } from '../../utils/settings';
import { spacing } from '../../theme';

// Ordering rules: types, payment, minimum, delivery fee, packaging, GST, tips, prep time, COD limit.
export default function SettingsOrdersScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['orders']);
    const o = ed.draft?.orders;
    const fee = o?.deliveryFee || {};
    const gst = o?.gst || {};
    const cod = o?.codCap || {};
    const tips = o?.tipOptions || [];
    const hasGstin = !!ed.rec?.tenant?.business?.gstin;

    const setFee = (k, v) => ed.set('orders', 'deliveryFee', { ...fee, [k]: v });
    const setGst = (k, v) => ed.set('orders', 'gst', { ...gst, [k]: v });
    const setCod = (k, v) => ed.set('orders', 'codCap', { ...cod, [k]: v });

    return (
        <SettingsPage ed={ed} title="Orders and fees" subtitle={name}>
            {ed.ready ? (
                <>
                    <Group title="Taking orders" section="orders">
                        <Switch
                            title="Accepting orders"
                            subtitle="The owner can also pause this from the shop app"
                            value={o.acceptingOrders !== false}
                            onValueChange={(v) => ed.set('orders', 'acceptingOrders', v)}
                        />
                        <View style={{ height: spacing.md }} />
                        <MultiChoice
                            label="Order types"
                            options={choices('orderType', ed.options.ORDER_TYPES)}
                            value={o.types}
                            min={1}
                            onChange={(v) => ed.set('orders', 'types', v)}
                        />
                        <MultiChoice
                            label="Payment methods"
                            options={choices('payment', ed.options.PAYMENT_METHODS)}
                            value={o.payments}
                            min={1}
                            onChange={(v) => ed.set('orders', 'payments', v)}
                        />
                        <NumberField label="Minimum order" prefix="₹" value={o.minOrder} onChange={(v) => ed.set('orders', 'minOrder', v ?? 0)} />
                        <NumberField label="Preparation time" suffix="min" integer value={o.prepTimeMin} onChange={(v) => ed.set('orders', 'prepTimeMin', v ?? 0)} last />
                    </Group>

                    <Group title="Delivery fee" section="orders">
                        <Choice options={choices('fee', ed.options.FEE_TYPES)} value={fee.type || 'free'} onChange={(v) => setFee('type', v)} last={(fee.type || 'free') === 'free'} />
                        {fee.type === 'flat' ? <NumberField label="Fee" prefix="₹" value={fee.amount} onChange={(v) => setFee('amount', v ?? 0)} last /> : null}
                        {fee.type === 'free_above' ? (
                            <>
                                <NumberField label="Fee below the limit" prefix="₹" value={fee.amount} onChange={(v) => setFee('amount', v ?? 0)} />
                                <NumberField label="Free for orders above" prefix="₹" value={fee.freeAbove} onChange={(v) => setFee('freeAbove', v ?? 0)} last />
                            </>
                        ) : null}
                        {fee.type === 'distance' ? (
                            <>
                                <NumberField label="Covers the first" suffix="km" value={fee.baseKm} onChange={(v) => setFee('baseKm', v ?? 0)} />
                                <NumberField label="Fee for that distance" prefix="₹" value={fee.baseFee} onChange={(v) => setFee('baseFee', v ?? 0)} />
                                <NumberField label="Then, for every extra km" prefix="₹" value={fee.perKmFee} onChange={(v) => setFee('perKmFee', v ?? 0)} />
                                <NumberField label="Highest fee (0 = no limit)" prefix="₹" value={fee.maxFee} onChange={(v) => setFee('maxFee', v ?? 0)} last />
                            </>
                        ) : null}
                    </Group>

                    <Group title="Charges and tax" section="money">
                        <NumberField label="Packaging charge" prefix="₹" value={o.packagingCharge} onChange={(v) => ed.set('orders', 'packagingCharge', v ?? 0)} />
                        <Choice label="GST" options={choices('gst', ed.options.GST_MODES)} value={gst.mode || 'none'} onChange={(v) => setGst('mode', v)} last={(gst.mode || 'none') === 'none'} />
                        {gst.mode && gst.mode !== 'none' ? <NumberField label="GST rate" suffix="%" value={gst.percent} onChange={(v) => setGst('percent', v ?? 0)} last /> : null}
                        {!hasGstin ? <Hint tone="warn">This shop has no GST number yet, so GST stays off for customers until you add it in Edit shop.</Hint> : null}
                    </Group>

                    <Group title="Tips" section="money" hint="Quick amounts shown to the customer (up to 5). Needs the Tips feature to be on.">
                        {tips.map((amt, i) => (
                            <View key={i} style={{ flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.sm }}>
                                <NumberField style={{ flex: 1 }} label={`Tip ${i + 1}`} prefix="₹" value={amt} last onChange={(v) => ed.set('orders', 'tipOptions', tips.map((x, k) => (k === i ? (v ?? 0) : x)))} />
                                <Button title="Remove" kind="dangerSoft" small style={{ marginLeft: spacing.sm }} onPress={() => ed.set('orders', 'tipOptions', tips.filter((_, k) => k !== i))} />
                            </View>
                        ))}
                        {tips.length < 5 ? <Button title="Add a tip amount" kind="soft" small icon="add" onPress={() => ed.set('orders', 'tipOptions', [...tips, 20])} /> : null}
                    </Group>

                    <Group title="Cash on delivery limit" section="alerts" hint="Protects the shop from fake first orders">
                        <NumberField label="Limit for a new customer's first orders" prefix="₹" value={cod.amount} hint="0 = no limit" onChange={(v) => setCod('amount', v ?? 0)} />
                        <NumberField label="Applies to the first" suffix="orders" integer value={cod.firstOrders} onChange={(v) => setCod('firstOrders', v ?? 0)} last />
                    </Group>
                </>
            ) : null}
        </SettingsPage>
    );
}
