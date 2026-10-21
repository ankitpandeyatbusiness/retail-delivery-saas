// Shared tables: pick one of the bills of a table (to move a round to, to merge into, or to open). Each shows its letter, the first name and the guests.
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useBrand, alpha } from '../common/kit';
import { Sheet } from './ui';
import { tr } from '../../i18n';

export default function PartyPickSheet({ visible, title, hint, options, onPick, onClose }) {
    const { text, muted, border, surface, primary } = useBrand();
    return (
        <Sheet visible={visible} onClose={onClose} title={title}>
            {hint ? <Text style={{ color: muted, marginBottom: 10 }}>{hint}</Text> : null}
            {(options || []).map((p) => (
                <Pressable key={p.sessionId} onPress={() => onPick(p)} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', padding: 12, borderRadius: 16, borderWidth: 1, borderColor: border, backgroundColor: surface, marginBottom: 10, opacity: pressed ? 0.7 : 1 })}>
                    <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: alpha(primary, 0.14), alignItems: 'center', justifyContent: 'center', marginRight: 12 }}>
                        <Text style={{ color: primary, fontWeight: '900', fontSize: 18 }}>{p.label}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: text, fontWeight: '800' }}>{tr('Bill {l}', { l: p.label })}{p.who ? ` · ${p.who}` : ''}</Text>
                        {p.sub ? <Text numberOfLines={1} style={{ color: muted, fontSize: 12.5 }}>{p.sub}</Text> : null}
                    </View>
                </Pressable>
            ))}
        </Sheet>
    );
}
