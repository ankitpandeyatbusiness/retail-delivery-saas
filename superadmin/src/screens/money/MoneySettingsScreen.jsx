import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Screen } from '../../components/layout';
import { Card, ListRow } from '../../components/ui';
import { fetchPlatform } from '../../api/moneyApi';

// The money settings in one place: set once, rarely changed. They used to sit between the daily views on the Money tab.
export default function MoneySettingsScreen() {
    const nav = useNavigation();
    const [p, setP] = useState(null);
    useFocusEffect(useCallback(() => { fetchPlatform().then(setP).catch(() => { }); }, []));
    const go = (screen) => () => nav.navigate(screen);
    return (
        <Screen title="Money settings" subtitle="Set once, change rarely">
            <Card padded={false} style={{ paddingHorizontal: 16 }}>
                <ListRow section="settings" icon="tune" title="Billing rules" subtitle="Free service, due days, grace, price tiers, when a shop is listed for closing" onPress={go('PlatformBilling')} />
                <ListRow section="money" icon="percent" title="GST on shop bills" subtitle="One rate for every shop, set only by you" onPress={go('Gst')} />
                <ListRow section="money" icon="tune" title="Cancel and refund rules" subtitle="Who bears the cost of a cancelled order. Recommended in one tap" onPress={go('MoneyRules')} />
                <ListRow section="platform" icon="bank" title="Business details" subtitle={p?.business?.gstin ? 'Printed on every invoice' : 'No GST number saved yet'} onPress={go('PlatformBusiness')} />
                <ListRow section="money" icon="bank" title="My Razorpay" subtitle="Your account for SMS top-ups and rent" onPress={go('MyRazorpay')} />
                <ListRow section="catalog" icon="coupon" title="SMS prices" subtitle="Price, cost and top-up packs" onPress={go('PlatformSms')} />
                <ListRow section="catalog" icon="wallet" title="SMS balance at the provider" subtitle="Your low line, the reserve for login OTPs" onPress={go('SmsBalance')} last />
            </Card>
        </Screen>
    );
}
