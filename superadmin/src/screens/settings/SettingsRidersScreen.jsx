import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, Choice, NumberField, Switch, Hint } from '../../components/settingsForm';

// how riders are paid (the same plans the owner can pick in the shop app)
const PAY = [
    { value: 'none', label: 'Paid in hand, not tracked' },
    { value: 'per_delivery', label: 'Per delivery' },
    { value: 'percent', label: 'Percent of the order' },
    { value: 'distance', label: 'By distance' },
    { value: 'salary', label: 'Salary' },
    { value: 'salary_plus', label: 'Salary + per delivery' },
];
const START = { none: { type: 'none' }, per_delivery: { type: 'per_delivery', perDelivery: 30 }, percent: { type: 'percent', percent: 10 }, distance: { type: 'distance', base: 20, freeKm: 2, perKm: 8 }, salary: { type: 'salary', salary: 12000, salaryEvery: 'month' }, salary_plus: { type: 'salary_plus', salary: 8000, salaryEvery: 'month', perDelivery: 15 } };
import useSettingsEditor from '../../hooks/useSettingsEditor';
import { choices } from '../../utils/settings';

// How delivery riders are chosen and tracked for this shop.
export default function SettingsRidersScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['riders']);
    const r = ed.draft?.riders;
    const set = (k) => (v) => ed.set('riders', k, v);
    const pay = r?.pay?.type ? r.pay : { type: r?.payPerDelivery > 0 ? 'per_delivery' : 'none', perDelivery: r?.payPerDelivery };
    const setPay = (patch) => set('pay')({ ...pay, ...patch });
    const pays = ['per_delivery', 'percent', 'distance', 'salary_plus'].includes(pay.type);

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
                    <Group title="How riders are paid" section="riders" hint="Pick one plan for the shop. A single rider can have his own on his page. The app only records and shows pay: the owner moves the money himself.">
                        <Choice label="Plan" options={PAY} value={pay.type} onChange={(v) => set('pay')(START[v])} last={pay.type === 'none'} />
                        {pay.type === 'per_delivery' || pay.type === 'salary_plus' ? <NumberField label="Paid for each delivery" prefix="₹" placeholder="e.g. 30" hint="1 to 10000" value={pay.perDelivery} onChange={(v) => setPay({ perDelivery: v ?? 0 })} /> : null}
                        {pay.type === 'percent' ? <NumberField label="Percent of each order" suffix="%" placeholder="e.g. 10" hint="0.5 to 100" value={pay.percent} onChange={(v) => setPay({ percent: v ?? 0 })} /> : null}
                        {pay.type === 'distance' ? (
                            <>
                                <NumberField label="Base amount for a delivery" prefix="₹" placeholder="e.g. 20" value={pay.base} onChange={(v) => setPay({ base: v ?? 0 })} />
                                <NumberField label="Distance covered by the base amount" suffix="km" placeholder="e.g. 2" hint="0 to 50, in a straight line from the shop to the customer" value={pay.freeKm} onChange={(v) => setPay({ freeKm: v ?? 0 })} />
                                <NumberField label="Extra for every further km" prefix="₹" placeholder="e.g. 8" value={pay.perKm} onChange={(v) => setPay({ perKm: v ?? 0 })} />
                            </>
                        ) : null}
                        {pay.type === 'salary' || pay.type === 'salary_plus' ? (
                            <>
                                <NumberField label="Salary" prefix="₹" placeholder="e.g. 12000" hint="1 to 1000000" value={pay.salary} onChange={(v) => setPay({ salary: v ?? 0 })} />
                                <Choice label="Paid every" options={[{ value: 'month', label: 'Month' }, { value: 'week', label: 'Week' }, { value: 'day', label: 'Day' }]} value={pay.salaryEvery || 'month'} onChange={(v) => setPay({ salaryEvery: v })} last={!pays} />
                            </>
                        ) : null}
                    </Group>
                    {pay.type !== 'none' ? (
                        <Group title="Pay records" section="riders" flush>
                            <Switch title="Record what the owner pays riders" subtitle="He writes down each payment. The rider sees what he earned and what was paid." value={!!r.trackPayouts} onValueChange={set('trackPayouts')} last={!pays} />
                            {pays ? <Switch title="Pay when the food was collected but not delivered" subtitle="Off: the rider earns nothing for an order that did not reach the customer." value={!!r.payUndelivered} onValueChange={set('payUndelivered')} last /> : null}
                        </Group>
                    ) : null}
                    <Group title="Cash a rider holds" section="riders" hint="Cash from cash-on-delivery orders. Over the limit, a rider gets no new orders until he gives cash to the shop.">
                        <NumberField label="Most cash one rider may hold" prefix="₹" placeholder="e.g. 2000" hint="0 = no limit" value={r.cashLimit} onChange={(v) => set('cashLimit')(v ?? 0)} last />
                    </Group>
                    <Hint>Riders themselves are added under the shop's Riders section.</Hint>
                </>
            ) : null}
        </SettingsPage>
    );
}
