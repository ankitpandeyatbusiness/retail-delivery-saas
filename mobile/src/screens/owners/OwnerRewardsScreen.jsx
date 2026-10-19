// Rewards: the shop's own numbers for customer points and for rider points and badges. "Reset to recommended" puts the suggested ones back.
// The app never pays money to riders: points and badges are for recognition, and for the owner's own reward outside the app.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useBrand } from '../../components/common/kit';
import { Button } from '../../components/owners/ui';
import { FormPage, Group, NumberBox, ToggleRow } from '../../components/owners/menuBits';
import { ListShimmer } from '../../components/owners/shimmer';
import { fetchRewards, saveRewards, apiError } from '../../api/owners/shopApi';
import { useOwnerStore } from '../../store/owners/useOwnerStore';
import { showToast } from '../../components/customers/shop';
import { ask } from '../../components/common/dialog';
import { tr } from '../../i18n';

export default function OwnerRewardsScreen() {
    const { muted } = useBrand();
    const [v, setV] = useState(null);            // what is on the screen
    const [rec, setRec] = useState(null);        // the recommended numbers
    const [dirty, setDirty] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => { fetchRewards().then((r) => { setV(r.settings); setRec(r.recommended); }).catch((e) => showToast(apiError(e))); }, []);
    const c = (k, x) => { setV((p) => ({ ...p, customer: { ...p.customer, [k]: x } })); setDirty(true); };
    const r = (k, x) => { setV((p) => ({ ...p, rider: { ...p.rider, [k]: x } })); setDirty(true); };
    const lvl = (name, k, x) => { setV((p) => ({ ...p, customer: { ...p.customer, levels: { ...p.customer.levels, [name]: { ...p.customer.levels[name], [k]: x ?? 0 } } } })); setDirty(true); };
    const star = (s, x) => { setV((p) => ({ ...p, rider: { ...p.rider, stars: { ...p.rider.stars, [s]: x ?? 0 } } })); setDirty(true); };
    const badge = (name, k, x) => { setV((p) => ({ ...p, rider: { ...p.rider, [name]: { ...p.rider[name], [k]: x ?? 0 } } })); setDirty(true); };

    const done = (res, msg) => { setV(res.settings); setRec(res.recommended); setDirty(false); showToast(msg); };
    const save = async () => {
        setBusy(true);
        try { done(await saveRewards({ customer: v.customer, rider: v.rider }), tr('Saved')); } catch (e) { useOwnerStore.getState().noteError(e); showToast(apiError(e)); } finally { setBusy(false); }
    };
    const reset = async () => {
        const yes = await ask({ title: tr('Use the recommended numbers?'), message: tr('Your own numbers are replaced by the recommended ones.'), confirmText: tr('Use recommended'), cancelText: tr('Cancel') });
        if (!yes) return;
        setBusy(true);
        try { done(await saveRewards({ reset: true }), tr('Recommended numbers are back')); } catch (e) { showToast(apiError(e)); } finally { setBusy(false); }
    };

    if (!v) return <FormPage title={tr('Rewards and points')}><ListShimmer count={3} /></FormPage>;
    const cu = v.customer;
    const ri = v.rider;
    return (
        <FormPage title={tr('Rewards and points')} footer={<Button label={tr('Save')} icon="checkmark" busy={busy} disabled={!dirty} onPress={save} />}>
            <Group title={tr('Customer points')} hint={tr('Customers earn points on their orders and use them for money off. Points reach them after the waiting time, so a refund never takes spent points back.')}>
                <ToggleRow title={tr('Give customers points')} value={cu.enabled} onValueChange={(x) => c('enabled', x)} last={!cu.enabled} />
                {cu.enabled ? (
                    <View>
                        <NumberBox label={tr('Points for every ₹10 spent')} hint={`${tr('Recommended')}: ${rec.customer.pointsPerTen}`} integer value={cu.pointsPerTen} onChange={(x) => c('pointsPerTen', x ?? 0)} />
                        <NumberBox label={tr('First order bonus')} suffix={tr('points')} hint={`${tr('Recommended')}: ${rec.customer.firstOrderBonus}`} integer value={cu.firstOrderBonus} onChange={(x) => c('firstOrderBonus', x ?? 0)} />
                        <NumberBox label={tr('Food review bonus')} suffix={tr('points')} hint={`${tr('Recommended')}: ${rec.customer.foodReviewBonus}`} integer value={cu.foodReviewBonus} onChange={(x) => c('foodReviewBonus', x ?? 0)} />
                        <NumberBox label={tr('Delivery review bonus')} suffix={tr('points')} hint={`${tr('Recommended')}: ${rec.customer.deliveryReviewBonus}`} integer value={cu.deliveryReviewBonus} onChange={(x) => c('deliveryReviewBonus', x ?? 0)} />
                        <NumberBox label={tr('Points arrive after')} suffix={tr('hours')} hint={`${tr('Recommended')}: ${rec.customer.holdHours}. ${tr('This is the time a customer could ask for a refund.')}`} integer value={cu.holdHours} onChange={(x) => c('holdHours', x ?? 0)} />
                        <NumberBox label={tr('Points that give ₹1 off')} hint={`${tr('Recommended')}: ${rec.customer.pointsPerRupee} (${rec.customer.pointsPerRupee * 10} = ₹10)`} integer value={cu.pointsPerRupee} onChange={(x) => c('pointsPerRupee', x ?? 1)} />
                        <NumberBox label={tr('Most of the food bill points can pay')} suffix="%" hint={`${tr('Recommended')}: ${rec.customer.maxPercent}`} integer value={cu.maxPercent} onChange={(x) => c('maxPercent', x ?? 1)} />
                        <NumberBox label={tr('Least points needed to use')} hint={`${tr('Recommended')}: ${rec.customer.minRedeem}`} integer value={cu.minRedeem} onChange={(x) => c('minRedeem', x ?? 0)} />
                        <NumberBox label={tr('Points last')} suffix={tr('months')} hint={`${tr('Recommended')}: ${rec.customer.expiryMonths}`} integer value={cu.expiryMonths} onChange={(x) => c('expiryMonths', x ?? 1)} />
                        <Text style={{ color: muted, fontSize: 12.5, marginBottom: 8 }}>{tr('Levels: by what a customer spent on food in the last 12 months. Each level gives extra points on every order.')}</Text>
                        {['silver', 'gold', 'platinum'].map((n, i, all) => (
                            <View key={n} style={{ flexDirection: 'row' }}>
                                <NumberBox style={{ flex: 1, marginRight: 10 }} label={tr('{n}: spend', { n: tr(n.charAt(0).toUpperCase() + n.slice(1)) })} prefix="₹" hint={`${tr('Recommended')}: ${rec.customer.levels[n].spend}`} integer value={cu.levels[n].spend} onChange={(x) => lvl(n, 'spend', x)} last={i === all.length - 1} />
                                <NumberBox style={{ flex: 1 }} label={tr('extra points')} suffix="%" hint={`${tr('Recommended')}: ${rec.customer.levels[n].bonusPct}`} integer value={cu.levels[n].bonusPct} onChange={(x) => lvl(n, 'bonusPct', x)} last={i === all.length - 1} />
                            </View>
                        ))}
                    </View>
                ) : null}
            </Group>

            <Group title={tr('Rider points and badges')} hint={tr('Riders earn points for good work. The badge (Bronze, Silver, Gold, Platinum) comes from the points of the last 30 days and the rating. Customers, you and the rider can see it. The app does not pay money: use the points to decide your own reward.')}>
                <ToggleRow title={tr('Use rider points and badges')} value={ri.enabled} onValueChange={(x) => r('enabled', x)} last={!ri.enabled} />
                {ri.enabled ? (
                    <View>
                        <NumberBox label={tr('Points for every delivery')} hint={`${tr('Recommended')}: ${rec.rider.perDelivery}`} integer value={ri.perDelivery} onChange={(x) => r('perDelivery', x ?? 0)} />
                        <NumberBox label={tr('Bonus for delivering on time')} hint={`${tr('Recommended')}: ${rec.rider.onTime}`} integer value={ri.onTime} onChange={(x) => r('onTime', x ?? 0)} />
                        {[5, 4, 3, 2, 1].map((s) => (
                            <NumberBox key={s} label={tr('Points for a {s} star rating', { s })} hint={`${tr('Recommended')}: ${rec.rider.stars[s]}`} integer value={ri.stars[s]} onChange={(x) => star(s, x)} />
                        ))}
                        <NumberBox label={tr('Complaint decided as his fault')} hint={`${tr('Recommended')}: ${rec.rider.fault}. ${tr('Use a minus number.')}`} integer value={ri.fault} onChange={(x) => r('fault', x ?? 0)} />
                        <NumberBox label={tr('Cancelled after collecting the food')} hint={`${tr('Recommended')}: ${rec.rider.cancelAfterPickup}`} integer value={ri.cancelAfterPickup} onChange={(x) => r('cancelAfterPickup', x ?? 0)} />
                        <NumberBox label={tr('Rated deliveries needed for Silver or higher')} hint={`${tr('Recommended')}: ${rec.rider.minRated}`} integer value={ri.minRated} onChange={(x) => r('minRated', x ?? 0)} />
                        {['silver', 'gold', 'platinum'].map((b, i, all) => (
                            <View key={b} style={{ flexDirection: 'row' }}>
                                <NumberBox style={{ flex: 1, marginRight: 10 }} label={tr('{b}: points', { b: tr(b.charAt(0).toUpperCase() + b.slice(1)) })} hint={`${tr('Recommended')}: ${rec.rider[b].points}`} integer value={ri[b].points} onChange={(x) => badge(b, 'points', x)} last={i === all.length - 1} />
                                <NumberBox style={{ flex: 1 }} label={tr('rating at least')} hint={`${tr('Recommended')}: ${rec.rider[b].rating}`} value={ri[b].rating} onChange={(x) => badge(b, 'rating', x)} last={i === all.length - 1} />
                            </View>
                        ))}
                        <Text style={{ color: muted, fontSize: 12.5, marginTop: 8 }}>{tr('Platinum also needs no complaint against him in the last 30 days.')}</Text>
                    </View>
                ) : null}
            </Group>

            <View style={{ paddingHorizontal: 16 }}>
                <Button label={tr('Use the recommended numbers')} icon="refresh" kind="ghost" disabled={busy} onPress={reset} />
            </View>
        </FormPage>
    );
}
