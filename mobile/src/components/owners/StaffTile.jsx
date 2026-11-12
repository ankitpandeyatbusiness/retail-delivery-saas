// One cook or waiter as a card on a computer (the owner's Staff, Kitchen staff and Waiters pages): the round picture with a duty-colour dot, name and number,
// the pills the page gives it, up to three numbers, and the on/off switch. Never used in the phone app.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Toggle } from './menuBits';

export default function StaffTile({ avatar, dot, name, phone, pills, numbers = [], active = true, onOpen, switchOn, onSwitch, locked }) {
    const { text, muted, surface, border, primary } = useBrand();
    return (
        <View style={{ padding: 8 }}>
            <Pressable onPress={onOpen} style={({ hovered }) => ({ borderRadius: 24, borderWidth: 1, borderColor: hovered ? primary : border, backgroundColor: hovered ? alpha(primary, 0.05) : surface, padding: 18, opacity: active ? 1 : 0.7, cursor: 'pointer', boxShadow: hovered ? `inset 0 0 0 1.5px ${primary}` : 'inset 0 0 0 0 transparent', transitionProperty: 'background-color, box-shadow', transitionDuration: '140ms' })}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View>
                        {avatar}
                        {dot ? <View style={{ position: 'absolute', right: 0, bottom: 0, width: 16, height: 16, borderRadius: 8, backgroundColor: dot, borderWidth: 3, borderColor: surface }} /> : null}
                    </View>
                    <View style={{ flex: 1, minWidth: 0, marginLeft: 14 }}>
                        <Text style={{ color: text, fontWeight: '900', fontSize: 17 }} numberOfLines={1}>{name}</Text>
                        {phone ? <Text style={{ color: muted, fontSize: 13, marginTop: 2 }}>{phone}</Text> : null}
                    </View>
                    {onSwitch ? <Toggle value={switchOn} onValueChange={onSwitch} disabled={locked} /> : null}
                </View>
                {pills ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 14 }}>{pills}</View> : null}
                {numbers.length ? (
                    <View style={{ flexDirection: 'row', marginTop: 8, paddingTop: 14, borderTopWidth: 1, borderTopColor: alpha(muted, 0.2) }}>
                        {numbers.map(([label, value]) => (
                            <View key={label} style={{ flex: 1, alignItems: 'center' }}>
                                <Text style={{ color: text, fontWeight: '900', fontSize: 18 }} numberOfLines={1}>{value}</Text>
                                <Text style={{ color: muted, fontSize: 11.5, fontWeight: '700', marginTop: 1 }} numberOfLines={1}>{label}</Text>
                            </View>
                        ))}
                    </View>
                ) : null}
            </Pressable>
        </View>
    );
}
