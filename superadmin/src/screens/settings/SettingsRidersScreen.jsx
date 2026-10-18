import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, NumberField, Switch, Hint } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices } from '../../utils/settings';

// How delivery riders are chosen and tracked for this shop.
export default function SettingsRidersScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['riders']);
    const r = ed.draft?.riders;
    const set = (k) => (v) => ed.set('riders', k, v);

    return (
        <SettingsPage ed={ed} title="Riders and delivery" subtitle={name}>
            {ed.ready ? (
                <>
                    <Group title="Assigning riders" section="riders">
                        <Choice
                            label="How a rider is chosen"
                            options={choices('assign', ed.options.ASSIGN_MODES)}
                            value={r.assignMode}
                            onChange={set('assignMode')}
                        />
                        <NumberField label="Time a rider has to accept" suffix="seconds" integer hint="30 to 600" value={r.offerSeconds} onChange={(v) => set('offerSeconds')(v ?? 120)} />
                        <NumberField label="Most orders at once per rider" integer hint="1 to 10" value={r.maxActiveOrders} onChange={(v) => set('maxActiveOrders')(v ?? 3)} last />
                    </Group>

                    <Group title="Safety and tracking" section="riders" flush>
                        <Switch
                            title="Delivery PIN"
                            subtitle="The customer gives a PIN to the rider on delivery"
                            value={!!r.deliveryPin}
                            onValueChange={set('deliveryPin')}
                        />
                        <Switch
                            title="Live tracking"
                            subtitle="Customers see the rider on the map"
                            value={!!r.liveTracking}
                            onValueChange={set('liveTracking')}
                            last
                        />
                    </Group>

                    <Group title="Location updates" section="riders">
                        <NumberField label="Rider location is sent every" suffix="seconds" integer hint="5 to 60. Lower is smoother but uses more battery and data." value={r.locationIntervalSec} onChange={(v) => set('locationIntervalSec')(v ?? 10)} last />
                    </Group>
                    <Hint>How riders are paid (salary, per delivery, percent, distance) and the cash limit are set by the shop owner in Delivery rules.</Hint>
                    <Hint>Riders themselves are added under the shop's Riders section.</Hint>
                </>
            ) : null}
        </SettingsPage>
    );
}
