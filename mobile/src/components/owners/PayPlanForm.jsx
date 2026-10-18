// "How do you pay your riders?" One list of plain choices; only the boxes of the chosen plan appear.
// Used for the whole shop (Delivery rules) and for a single rider (his own plan, or "same as the shop").
import React from 'react';
import { View } from 'react-native';
import { Option } from './ui';
import { NumberBox, ChoiceBox } from './menuBits';

export const PAY_TYPES = [
    ['none', 'I pay in hand', 'The app does not track pay'],
    ['salary', 'Fixed salary', 'The same every day, week or month'],
    ['per_delivery', 'A fixed amount for each delivery', ''],
    ['percent', 'A percent of each order', ''],
    ['distance', 'A base amount + extra for distance', 'Pay grows with the km to the customer'],
    ['salary_plus', 'Salary + an amount for each delivery', ''],
];

// sensible starting numbers when the owner picks a plan
const START = {
    none: {},
    salary: { salary: 10000, salaryEvery: 'month' },
    per_delivery: { perDelivery: 30 },
    percent: { percent: 10 },
    distance: { base: 20, freeKm: 2, perKm: 5 },
    salary_plus: { salary: 8000, salaryEvery: 'month', perDelivery: 10 },
};
export const startPlan = (type) => ({ type, ...(START[type] || {}) });

export const paysPerDelivery = (plan) => ['per_delivery', 'percent', 'distance', 'salary_plus'].includes(plan?.type);

// the same rules the server checks, so a mistake is shown before saving. '' = fine
export function planProblem(plan) {
    if (!plan || plan.type === 'same' || plan.type === 'none') return '';
    const bad = (v, min, max) => !(typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max);
    if ((plan.type === 'salary' || plan.type === 'salary_plus') && bad(plan.salary, 1, 1000000)) return 'Enter the salary';
    if ((plan.type === 'per_delivery' || plan.type === 'salary_plus') && bad(plan.perDelivery, 1, 10000)) return 'Enter the amount for each delivery';
    if (plan.type === 'percent' && bad(plan.percent, 0.5, 100)) return 'Enter a percent from 0.5 to 100';
    if (plan.type === 'distance') {
        if (bad(plan.base, 0, 10000) || bad(plan.freeKm, 0, 50) || bad(plan.perKm, 0, 1000)) return 'Fill the base amount, the free distance and the amount per km';
        if (!(plan.base > 0 || plan.perKm > 0)) return 'Give a base amount or an amount per km';
    }
    return '';
}

// value: { type, ... } (or { type: 'same' } when allowSame). sameText: what "same as the shop" means right now.
export default function PayPlanForm({ value, onChange, allowSame, sameText }) {
    const v = value || { type: 'none' };
    const set = (patch) => onChange({ ...v, ...patch });
    const pick = (type) => { if (type !== v.type) onChange(type === 'same' ? { type: 'same' } : startPlan(type)); };
    const hasSalary = v.type === 'salary' || v.type === 'salary_plus';
    return (
        <View>
            {allowSame ? <Option selected={v.type === 'same'} title="Same as the shop" subtitle={sameText} onPress={() => pick('same')} /> : null}
            {PAY_TYPES.map(([type, title, sub], i) => (
                <Option key={type} selected={v.type === type} title={title} subtitle={sub || undefined} onPress={() => pick(type)} last={i === PAY_TYPES.length - 1 && v.type === 'same'} />
            ))}
            {v.type !== 'none' && v.type !== 'same' ? (
                <View style={{ marginTop: 10 }}>
                    {hasSalary ? (
                        <>
                            <NumberBox label="Salary" prefix="₹" value={v.salary} onChange={(x) => set({ salary: x })} />
                            <ChoiceBox label="Paid" options={[['day', 'Every day'], ['week', 'Every week'], ['month', 'Every month']]} value={v.salaryEvery} onChange={(x) => set({ salaryEvery: x })} />
                        </>
                    ) : null}
                    {v.type === 'per_delivery' || v.type === 'salary_plus' ? <NumberBox label="For each delivery" prefix="₹" value={v.perDelivery} onChange={(x) => set({ perDelivery: x })} /> : null}
                    {v.type === 'percent' ? <NumberBox label="Percent of the order total" suffix="%" value={v.percent} onChange={(x) => set({ percent: x })} /> : null}
                    {v.type === 'distance' ? (
                        <>
                            <NumberBox label="Base amount for each delivery" prefix="₹" value={v.base} onChange={(x) => set({ base: x })} />
                            <NumberBox label="Distance with no extra pay" suffix="km" value={v.freeKm} onChange={(x) => set({ freeKm: x })} />
                            <NumberBox label="Extra for every km after that" prefix="₹" value={v.perKm} onChange={(x) => set({ perKm: x })} hint="The distance is a straight line from the shop to the customer." last />
                        </>
                    ) : null}
                </View>
            ) : null}
        </View>
    );
}
