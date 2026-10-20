import React, { useEffect, useState } from 'react';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import { Card, Button } from '../../components/ui';
import { SkeletonList } from '../../components/blocks';
import { ErrorBox, toast } from '../../components/feedback';
import { Switch, Hint } from '../../components/settingsForm';
import { fetchPoints, savePoints } from '../../api/shopsApi';
import { errMsg } from '../../api/adminClient';

// Points and rewards for ONE shop: switch the customer points, and the rider points and badges, on or off.
// Off removes it from that shop's apps (the My points entry in the customer app, the points and badge in the rider app, points earned and spent).
export default function SettingsPointsScreen() {
    const nav = useNavigation();
    const { shopId, name } = useRoute().params;
    const [v, setV] = useState(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => { fetchPoints(shopId).then(setV).catch((e) => setError(errMsg(e))); }, [shopId]);

    const save = async () => {
        setBusy(true);
        try { await savePoints(shopId, { customer: v.customer, rider: v.rider }); toast('Saved'); nav.goBack(); } catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(false); }
    };
    if (!v) return <Screen title="Points and rewards" subtitle={name}>{error ? <ErrorBox message={error} /> : <SkeletonList count={2} avatar={false} />}</Screen>;
    return (
        <Screen title="Points and rewards" subtitle={name}>
            <Card>
                <Switch title="Points for customers" subtitle="Earn points on orders and spend them for money off" value={v.customer} onValueChange={(x) => setV({ ...v, customer: x })} />
                <Switch title="Points and badges for riders" subtitle="Rider points, badge and Top riders" value={v.rider} onValueChange={(x) => setV({ ...v, rider: x })} last />
            </Card>
            <Hint>The point numbers (how many points, levels, expiry) are in the owner's Rewards screen. These two switches are the same ones the owner has there, so whoever saves last decides.</Hint>
            <Button title="Save" onPress={save} loading={busy} />
        </Screen>
    );
}
