import React, { useCallback, useState } from 'react';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { spacing } from '../../theme';
import { Screen } from '../../components/layout';
import { Card, SectionTitle, ListRow, Badge } from '../../components/ui';
import { fetchSupportCounts } from '../../api/supportApi';

// Everything about the shops as a whole, in one place: how they are doing, what owners ask and what you tell them.
// (They used to sit in More.)
export default function ShopsToolsScreen() {
    const nav = useNavigation();
    const [help, setHelp] = useState(0);
    useFocusEffect(useCallback(() => { fetchSupportCounts().then((c) => setHelp(c.open || 0)).catch(() => { }); }, []));
    const go = (screen) => () => nav.navigate(screen);
    return (
        <Screen title="Health, support and owners" subtitle="Every shop together">
            <SectionTitle section="riders">How the shops are doing</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="riders" icon="shield" title="Shop health" subtitle="Scores, cancellations, late orders" onPress={go('Health')} />
                <ListRow section="shops" icon="chart" title="Shops growth" subtitle="Top shops, who is growing, who is slowing down" onPress={go('ShopsGrowth')} last />
            </Card>

            <SectionTitle section="orders">Owners</SectionTitle>
            <Card padded={false} style={{ paddingHorizontal: spacing.lg }}>
                <ListRow section="orders" icon="message" title="Support requests" subtitle="Help requests from shop owners" right={help > 0 ? <Badge label={`${help} waiting`} tone="danger" /> : null} onPress={go('Support')} />
                <ListRow section="platform" icon="megaphone" title="Messages to owners" subtitle="Write to all shop owners" onPress={go('OwnerMessages')} />
                <ListRow section="platform" icon="notes" title="Agreements and terms" subtitle="Read them; the supreme admin writes and sends them" onPress={go('Agreements')} last />
            </Card>
        </Screen>
    );
}
