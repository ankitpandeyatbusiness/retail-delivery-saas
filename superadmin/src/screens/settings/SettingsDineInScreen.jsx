import React from 'react';
import { useRoute } from '@react-navigation/native';
import { SettingsPage } from '../../components/settingsPage';
import { Group, NumberField, TextField, Switch, Hint, MultiChoice } from '../../components/settingsForm';
import useSettingsEditor from '../../hooks/useSettingsEditor';

// Dine in, pickup rules, orders at the same time, and the timings and counts that used to be fixed in the code.
// Everything the shop owner can change in the shop app is here too, for THIS shop only.
export default function SettingsDineInScreen() {
    const { shopId, name } = useRoute().params;
    const ed = useSettingsEditor(shopId, ['orders']);
    const o = ed.draft?.orders;
    const dn = o?.dineIn || {};
    const pc = o?.pickupCod || {};
    const pr = o?.pickupRules || {};
    const mx = o?.mixRules || {};
    const lm = o?.limits || {};
    const sf = o?.staff || {};
    const D = (k) => (v) => ed.set('orders', 'dineIn', { ...dn, [k]: v });
    const num = (k, d = 0) => (v) => D(k)(v ?? d);
    const P = (sec, cur, k) => (v) => ed.set('orders', sec, { ...cur, [k]: v });
    const off = dn.enabled !== true;

    return (
        <SettingsPage ed={ed} title="Dine in and pickup rules" subtitle={name}>
            {ed.ready ? (
                <>
                    <Group title="Dine in" section="orders" hint="Eating at the shop, with a bill for the table. The owner can change all of this from the shop app too.">
                        <Switch title="Dine in is on" value={dn.enabled === true} onValueChange={D('enabled')} />
                        <NumberField label="Number of tables" integer value={dn.tableCount} onChange={num('tableCount', 10)} />
                        <NumberField label="Usual waiting time shown to customers" suffix="min" integer hint="0 = do not show" value={dn.waitMin} onChange={num('waitMin')} />
                        <NumberField label="A guest can cancel a round himself for" suffix="min" integer hint="0 = he can only ask the shop" value={dn.cancelGraceMin} onChange={num('cancelGraceMin', 3)} last />
                    </Group>

                    <Group title="Kitchen and waiter staff" section="orders" hint="Lets the owner add cooks and waiters by phone number. Each person signs in with an OTP and sees only their own screen. Off by default. Switching one off locks out the people with that job at once; their data stays and they come back when it is on again.">
                        <Switch title="Kitchen screen" subtitle="The cook sees the orders to make" value={sf.kitchenOn === true} onValueChange={P('staff', sf, 'kitchenOn')} />
                        <Switch title="Waiter screen" subtitle="The waiter sees dishes to serve and table requests" value={sf.waiterOn === true} onValueChange={P('staff', sf, 'waiterOn')} />
                        <NumberField label="Most staff this shop can add" integer hint="Cooks and waiters together" value={sf.max} onChange={(v) => P('staff', sf, 'max')(v ?? 10)} />
                        <Switch title="The guest sees his place in the kitchen" subtitle="For example: 2 orders ahead of yours" value={sf.queueShown !== false} onValueChange={P('staff', sf, 'queueShown')} />
                        {sf.queueShown !== false ? <Switch title="...and about how long it will take" subtitle="A guess from how long this shop really takes" value={sf.queueEta !== false} onValueChange={P('staff', sf, 'queueEta')} /> : null}
                        {sf.queueShown !== false ? <NumberField label="Orders the kitchen cooks at the same time" integer hint="Used for the time guess. More at once means a shorter wait." value={sf.kitchenLanes} onChange={(v) => P('staff', sf, 'kitchenLanes')(v ?? 3)} /> : null}
                        <MultiChoice label="The cook sees these orders" hint="Pick at least one" options={[{ value: 'delivery', label: 'Delivery' }, { value: 'pickup', label: 'Pickup' }, { value: 'dine_in', label: 'Dine in' }]} value={sf.kitchenSees || ['delivery', 'pickup', 'dine_in']} min={1} onChange={(v) => P('staff', sf, 'kitchenSees')(v)} />
                        <NumberField label="A ready dish waits for the waiter at most" suffix="min" integer hint="After this it shows as late on the waiter's screen" value={sf.serveLateMin} onChange={(v) => P('staff', sf, 'serveLateMin')(v ?? 5)} />
                        <TextField label="Shop UPI ID (the QR a waiter shows at the table)" hint="The owner has the same field. Looks like shopname@bank. Empty = no QR." value={dn.upiId || ''} onChange={(x) => D('upiId')(String(x || '').trim())} placeholder="shopname@bank" autoCapitalize="none" />
                        <Switch title="A waiter can take the money for a bill" subtitle="The owner has the same switch in the shop app" value={dn.waiterSettles !== false} onValueChange={D('waiterSettles')} />
                        <NumberField label="Nudge the cooks when an order waits" suffix="min" integer hint="A push for an accepted order nobody started. 0 = no nudges. Late and unserved dishes are nudged once too." value={sf.nudgeMin} onChange={(v) => P('staff', sf, 'nudgeMin')(v ?? 10)} />
                        <NumberField label="Show an order as late after" suffix="min" integer hint="Counted from when it was accepted (a pickup for later: from 30 minutes before its time)" value={sf.lateMin} onChange={(v) => P('staff', sf, 'lateMin')(v ?? 20)} last />
                    </Group>

                    <Group title="Walk-out protection" section="orders">
                        <NumberField label="Unpaid bill limit, new customer" prefix="₹" hint="0 = no limit" value={dn.tabLimitNew} onChange={num('tabLimitNew')} />
                        <NumberField label="Unpaid bill limit, regular customer" prefix="₹" hint="0 = no limit" value={dn.tabLimitTrusted} onChange={num('tabLimitTrusted')} />
                        <NumberField label="A regular customer after" suffix="paid visits" integer value={dn.trustedAfter} onChange={num('trustedAfter', 3)} />
                        <Switch title="Customer must be at the shop to order" value={dn.atShopCheck !== false} onValueChange={D('atShopCheck')} />
                        <NumberField label="Distance counted as at the shop" suffix="metres" integer value={dn.radiusM} onChange={num('radiusM', 250)} />
                        <NumberField label="Alert the owner when nobody asked for the bill after" suffix="min" integer value={dn.checkMinutes} onChange={num('checkMinutes', 20)} />
                        <Switch title="A first visit must be paid online" value={dn.firstOnline === true} onValueChange={D('firstOnline')} last />
                    </Group>

                    <Group title="Kitchen and busy mode" section="orders">
                        <Switch title="Mark dishes ready by themselves" value={dn.autoReady === true} onValueChange={D('autoReady')} />
                        {dn.autoReady ? <NumberField label="Ready after" suffix="min" integer value={dn.readyMin} onChange={num('readyMin', 15)} /> : null}
                        <Switch title="Mark dishes served by themselves" value={dn.autoServe === true} onValueChange={D('autoServe')} />
                        {dn.autoServe ? <NumberField label="Served after ready, in" suffix="min" integer value={dn.serveMin} onChange={num('serveMin', 10)} /> : null}
                        <Switch title="Busy mode by itself" subtitle="A longer wait when many tables are full" value={dn.busyAuto !== false} onValueChange={D('busyAuto')} />
                        {dn.busyAuto !== false ? (
                            <>
                                <NumberField label="Busy when this much of the tables are in use" suffix="%" integer value={dn.busyPercent} onChange={num('busyPercent', 70)} />
                                <NumberField label="Extra wait shown" suffix="min" integer value={dn.busyExtraMin} onChange={num('busyExtraMin', 10)} last />
                            </>
                        ) : null}
                    </Group>

                    <Group title="Unpaid bills (walk-outs)" section="orders">
                        <Switch title="Remind every day by itself" value={dn.owedDaily === true} onValueChange={D('owedDaily')} />
                        {dn.owedDaily ? (
                            <>
                                <NumberField label="Reminder hour (0 to 23)" integer value={dn.owedHour} onChange={num('owedHour', 11)} />
                                <NumberField label="Stop after" suffix="reminders" integer value={dn.owedMax} onChange={num('owedMax', 7)} />
                            </>
                        ) : null}
                        <Switch title="Show unpaid bills on the owner's Home" value={dn.owedOnHome !== false} onValueChange={D('owedOnHome')} last />
                    </Group>

                    <Group title="Offers on table orders" section="orders" hint="One offer per order, the best one. A coupon replaces it.">
                        <Switch title="Welcome offer (first visit)" value={dn.welcomeOn === true} onValueChange={D('welcomeOn')} />
                        {dn.welcomeOn ? (
                            <>
                                <NumberField label="Percent off" suffix="%" value={dn.welcomePercent} onChange={num('welcomePercent', 10)} />
                                <NumberField label="Highest discount" prefix="₹" value={dn.welcomeMax} onChange={num('welcomeMax', 100)} />
                            </>
                        ) : null}
                        <Switch title="Regular customer offer" value={dn.regularOn === true} onValueChange={D('regularOn')} />
                        {dn.regularOn ? (
                            <>
                                <NumberField label="After" suffix="paid visits" integer value={dn.regularAfter} onChange={num('regularAfter', 5)} />
                                <NumberField label="Percent off" suffix="%" value={dn.regularPercent} onChange={num('regularPercent', 5)} />
                                <NumberField label="Highest discount" prefix="₹" value={dn.regularMax} onChange={num('regularMax', 50)} />
                            </>
                        ) : null}
                        <Switch title="Happy hour" value={dn.happyOn === true} onValueChange={D('happyOn')} last={dn.happyOn !== true} />
                        {dn.happyOn ? (
                            <>
                                <TextField label="From (24-hour, like 15:00)" value={dn.happyFrom} onChange={D('happyFrom')} maxLength={5} />
                                <TextField label="To (like 18:00)" value={dn.happyTo} onChange={D('happyTo')} maxLength={5} />
                                <NumberField label="Percent off" suffix="%" value={dn.happyPercent} onChange={num('happyPercent', 15)} />
                                <NumberField label="Highest discount" prefix="₹" value={dn.happyMax} onChange={num('happyMax', 150)} last />
                            </>
                        ) : null}
                    </Group>

                    <Group title="Guests at the table" section="orders">
                        <Switch title="Call the waiter" value={dn.callOn === true} onValueChange={D('callOn')} />
                        <Switch title="Tip for the waiter" value={dn.tipOn === true} onValueChange={D('tipOn')} />
                        {dn.tipOn ? <TextField label="Tip amounts in rupees (up to 4, separated by commas)" value={(dn.tipChoices || []).join(', ')} onChange={(t) => D('tipChoices')(t.split(',').map((x) => parseInt(x, 10)).filter((x) => x >= 1 && x <= 1000).slice(0, 4))} keyboardType="numbers-and-punctuation" /> : null}
                        <Switch title="Private feedback after paying" value={dn.feedbackOn === true} onValueChange={D('feedbackOn')} />
                        <TextField label="Food choices on the cart (up to 12, separated by commas)" value={(dn.prefs || []).join(', ')} onChange={(t) => D('prefs')(t.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 12))} multiline last />
                    </Group>

                    <Group title="Refer a friend" section="orders">
                        <Switch title="Refer a friend is on" value={dn.referOn === true} onValueChange={D('referOn')} last={dn.referOn !== true} />
                        {dn.referOn ? (
                            <>
                                <NumberField label="Friend's first-meal offer" suffix="%" value={dn.referFriendPercent} onChange={num('referFriendPercent', 15)} />
                                <NumberField label="Friend's highest discount" prefix="₹" value={dn.referFriendMax} onChange={num('referFriendMax', 150)} />
                                <NumberField label="Points for the one who referred" suffix="points" integer value={dn.referPoints} onChange={num('referPoints', 50)} />
                                <NumberField label="Rewarded friends per customer" integer value={dn.referLimit} onChange={num('referLimit', 10)} last />
                            </>
                        ) : null}
                    </Group>

                    <Group title="Pickup orders" section="orders">
                        <Switch title="Allow cash for pickup orders" value={pc.enabled !== false} onValueChange={P('pickupCod', pc, 'enabled')} />
                        {pc.enabled !== false ? <NumberField label="Highest cash pickup order" prefix="₹" hint="0 = no limit" value={pc.max} onChange={(v) => P('pickupCod', pc, 'max')(v ?? 0)} /> : null}
                        <NumberField label="Pickup orders one customer can have waiting" integer hint="0 = no limit" value={pr.openMax} onChange={(v) => P('pickupRules', pr, 'openMax')(v ?? 0)} />
                        <Switch title="Customer can ask to change the pickup time" value={pr.canChange !== false} onValueChange={P('pickupRules', pr, 'canChange')} last />
                    </Group>

                    <Group title="Orders at the same time" section="orders" hint="What a customer can do while he already has an order or a table bill.">
                        <Switch title="Table bill blocks delivery and pickup" value={mx.dineBlocksOthers !== false} onValueChange={P('mixRules', mx, 'dineBlocksOthers')} />
                        <NumberField label="Delivery orders on the way at once" integer hint="0 = no limit" value={mx.deliveryOpenMax} onChange={(v) => P('mixRules', mx, 'deliveryOpenMax')(v ?? 0)} />
                        <Switch title="Limit all the cash he owes together" value={mx.exposureOn !== false} onValueChange={P('mixRules', mx, 'exposureOn')} />
                        {mx.exposureOn !== false ? (
                            <>
                                <NumberField label="Limit, new customer" prefix="₹" hint="0 = no limit" value={mx.exposureNew} onChange={(v) => P('mixRules', mx, 'exposureNew')(v ?? 0)} />
                                <NumberField label="Limit, regular customer" prefix="₹" hint="0 = no limit" value={mx.exposureTrusted} onChange={(v) => P('mixRules', mx, 'exposureTrusted')(v ?? 0)} />
                            </>
                        ) : null}
                        <NumberField label="A regular customer after" suffix="delivered orders" integer value={mx.regularAfter} onChange={(v) => P('mixRules', mx, 'regularAfter')(v ?? 3)} last />
                    </Group>

                    <Group title="Platform timings and counts" section="platform" hint="Only you can change these, not the owner. They used to be fixed in the code.">
                        <NumberField label="Times a customer can ask to change a pickup time" integer value={lm.pickupAsksMax} onChange={(v) => P('limits', lm, 'pickupAsksMax')(v ?? 3)} />
                        <NumberField label="Pickup time windows shown per day" integer value={lm.pickupSlotsPerDay} onChange={(v) => P('limits', lm, 'pickupSlotsPerDay')(v ?? 12)} />
                        <NumberField label="'Bring it fast' works after" suffix="min" integer value={lm.nudgeFirstMin} onChange={(v) => P('limits', lm, 'nudgeFirstMin')(v ?? 3)} />
                        <NumberField label="'Bring it fast' again after" suffix="min" integer value={lm.nudgeEveryMin} onChange={(v) => P('limits', lm, 'nudgeEveryMin')(v ?? 10)} />
                        <NumberField label="Same call to the waiter again after" suffix="min" integer hint="0 = no wait" value={lm.callGapMin} onChange={(v) => P('limits', lm, 'callGapMin')(v ?? 2)} />
                        <NumberField label="Open calls close by themselves after" suffix="hours" integer value={lm.callClearHours} onChange={(v) => P('limits', lm, 'callClearHours')(v ?? 2)} />
                        <NumberField label="Owner can remind about one bill again after" suffix="min" integer value={lm.remindGapMin} onChange={(v) => P('limits', lm, 'remindGapMin')(v ?? 30)} />
                        <NumberField label="'I already paid' can be sent again after" suffix="min" integer value={lm.claimRetryMin} onChange={(v) => P('limits', lm, 'claimRetryMin')(v ?? 5)} />
                        <NumberField label="Same phone counted again as a QR scan after" suffix="min" integer hint="0 = count every scan" value={lm.scanGapMin} onChange={(v) => P('limits', lm, 'scanGapMin')(v ?? 5)} />
                        <NumberField label="Strikes before cash is blocked for a phone" integer value={lm.strikesMax} onChange={(v) => P('limits', lm, 'strikesMax')(v ?? 2)} last />
                    </Group>
                    <Hint>These apply to this shop only. Other shops keep their own values.</Hint>
                </>
            ) : null}
        </SettingsPage>
    );
}
