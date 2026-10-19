// Cancel and refund rules: who bears the cost when an order paid online is cancelled or not collected. The platform sets the most a shop
// can keep; the owner may be KINDER to his customers than that (a lower share, a longer free time), never harder. One tap goes back to
// the platform's rules.
import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useBrand } from '../../components/common/kit';
import { Button } from '../../components/owners/ui';
import { FormPage, Group, NumberBox } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchMoneyRules, saveMoneyRules, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { tr } from '../../i18n';

const ROWS = [
    ['graceMinutes', 'Free time after you accept', 'minutes', true],
    ['accepted', 'You keep after accepting', '%'],
    ['preparing', 'You keep while it is being prepared', '%'],
    ['ready', 'You keep when it is ready', '%'],
    ['out_for_delivery', 'You keep when it is on the road', '%'],
    ['noShow', 'You keep when the customer does not come or cannot be reached', '%'],
];

export default function OwnerMoneyRulesScreen() {
    const { muted } = useBrand();
    const [d, setD] = useState(null);        // { platform, own, effective, recommended }
    const [v, setV] = useState(null);        // what is on screen
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);

    const take = (r) => { setD(r); setV({ ...r.effective }); setDirty(false); };
    useEffect(() => { fetchMoneyRules().then(take).catch((e) => showToast(apiError(e))); }, []);

    const save = async () => {
        setBusy(true);
        try { take(await saveMoneyRules(v)); showToast(tr('Saved')); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    const recommended = async () => {
        setBusy(true);
        try { take(await saveMoneyRules({ reset: true })); showToast(tr('Back to the recommended rules')); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    if (!v) return <FormPage title={tr('Cancel and refund rules')}><ListShimmer count={3} /></FormPage>;
    return (
        <FormPage title={tr('Cancel and refund rules')} footer={<Button label={tr('Save')} icon="checkmark" busy={busy} disabled={!dirty} onPress={save} />}>
            <Group
                title={tr('When an order paid online is cancelled')}
                hint={tr('This decides how much of the food money you keep when a customer cancels late or does not come. The rest is refunded to him. You can be kinder than the platform, never harder. Cash orders have nothing to refund.')}
            >
                {ROWS.map(([k, label, suffix, isTime], i) => (
                    <NumberBox
                        key={k} label={tr(label)} suffix={suffix === '%' ? '%' : tr(suffix)} integer value={v[k]}
                        hint={isTime ? tr('Platform: at least {n} minutes', { n: d.platform[k] }) : tr('Platform allows up to {n}%', { n: d.platform[k] })}
                        onChange={(x) => { setV((p) => ({ ...p, [k]: x ?? 0 })); setDirty(true); }}
                        last={i === ROWS.length - 1}
                    />
                ))}
            </Group>
            <Text style={{ color: muted, fontSize: 12.5, marginHorizontal: 16, marginBottom: 14 }}>
                {tr('Always a full refund: when you, the delivery partner or the platform is at fault, when nobody accepted in time, or when the delivery was more than an hour late.')}
            </Text>
            <View style={{ paddingHorizontal: 16 }}>
                <Button label={tr('Use the recommended rules')} icon="refresh" kind="ghost" disabled={busy} onPress={recommended} />
                <Text style={{ color: muted, fontSize: 12, marginTop: 8 }}>{tr('This follows the platform\'s rules exactly.')}</Text>
            </View>
        </FormPage>
    );
}
