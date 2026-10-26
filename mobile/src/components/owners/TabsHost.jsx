// One page made of a few screens that belong together (Transactions, Home screen pictures, Bills and SMS...). The tabs sit under one title; each
// screen is shown as it always was, minus its own title bar, and stays alive when the owner switches tabs (nothing reloads or loses its place).
//   <TabsHost title="Bills and SMS" tabs={[['bill', 'Monthly bill', OwnerRentScreen], ['sms', 'SMS', OwnerSmsScreen]]} />
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../common/kit';
import { PageHeader, Chips, EmbeddedCtx } from './ui';
import { tr } from '../../i18n';

export default function TabsHost({ title, tabs }) {
    const { background } = useBrand();
    const first = useRoute().params?.tab;
    const start = tabs.some((t) => t[0] === first) ? first : tabs[0][0];
    const [on, setOn] = useState(start);
    const [seen, setSeen] = useState({ [start]: true });
    const pick = (id) => { setSeen((s) => ({ ...s, [id]: true })); setOn(id); };
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr(title)} />
            <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
                <Chips options={tabs.map(([id, label]) => [id, tr(label)])} value={on} onChange={pick} style={{ marginTop: 0 }} />
            </View>
            {tabs.map(([id, , Screen]) => (seen[id] ? (
                <View key={id} style={{ flex: 1, display: id === on ? 'flex' : 'none' }}>
                    <EmbeddedCtx.Provider value><Screen /></EmbeddedCtx.Provider>
                </View>
            ) : null))}
        </View>
    );
}
