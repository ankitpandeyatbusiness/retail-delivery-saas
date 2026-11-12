// One page made of a few screens that belong together (Transactions, Home screen pictures, Bills and SMS...). The tabs sit under one title; each
// screen is shown as it always was, minus its own title bar, and stays alive when the owner switches tabs (nothing reloads or loses its place).
//   <TabsHost title="Delivery" tabs={[['area', 'Area and fees', OwnerDeliveryScreen], ['rules', 'Rules and cash', OwnerRiderRulesScreen]]} />
import React, { useState } from 'react';
import { View } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useBrand } from '../common/kit';
import { PageHeader, Chips, EmbeddedCtx, TabCtx } from './ui';
import { Pressable, Text } from 'react-native';
import { useBrand as useBrandColors, alpha } from '../common/kit';
import { useOwnerDesktop } from '../../utils/common/layout';
import { tr } from '../../i18n';

export default function TabsHost({ title, tabs }) {
    const desk = useOwnerDesktop();   // a computer: the tabs as a rounded switch bar
    const { primary, onPrimary, text, muted } = useBrandColors();
    const { background } = useBrand();
    const first = useRoute().params?.tab;
    const start = tabs.some((t) => t[0] === first) ? first : tabs[0][0];
    const [on, setOn] = useState(start);
    const [seen, setSeen] = useState({ [start]: true });
    const pick = (id) => { setSeen((s) => ({ ...s, [id]: true })); setOn(id); };
    return (
        <View style={{ flex: 1, backgroundColor: background }}>
            <PageHeader title={tr(title)} />
            {desk ? (
                <View style={{ width: '100%', maxWidth: 1240, alignSelf: 'center', paddingHorizontal: 24, paddingBottom: 12, flexDirection: 'row' }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, borderRadius: 25, backgroundColor: alpha(muted, 0.12) }}>
                        {tabs.map(([id, label]) => (
                            <Pressable key={id} onPress={() => pick(id)} style={({ hovered }) => ({ paddingHorizontal: 20, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: on === id ? primary : hovered ? alpha(primary, 0.1) : 'transparent', cursor: 'pointer', boxShadow: on === id ? `0 6px 16px ${alpha(primary, 0.35)}` : 'none', transitionProperty: 'background-color', transitionDuration: '140ms' })}>
                                <Text style={{ color: on === id ? onPrimary : text, fontWeight: '800', fontSize: 14 }}>{tr(label)}</Text>
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : (
            <View style={{ paddingHorizontal: 16, paddingBottom: 4 }}>
                <Chips options={tabs.map(([id, label]) => [id, tr(label)])} value={on} onChange={pick} style={{ marginTop: 0 }} />
            </View>
            )}
            {tabs.map(([id, , Screen]) => (seen[id] ? (
                <View key={id} style={{ flex: 1, display: id === on ? 'flex' : 'none' }}>
                    <EmbeddedCtx.Provider value><TabCtx.Provider value={desk}><Screen /></TabCtx.Provider></EmbeddedCtx.Provider>
                </View>
            ) : null))}
        </View>
    );
}
