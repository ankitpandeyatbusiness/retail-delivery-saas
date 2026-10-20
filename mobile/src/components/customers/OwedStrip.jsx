// "You have an unpaid bill" with a way back into the bill and the Pay button. Shown on the Orders and Account screens.
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from '../common/kit';
import { useTableBill } from '../../store/customers/useTableBill';
import { useOwedPrompt } from '../../store/customers/useOwedPrompt';
import { whereOf } from '../../utils/common/where';
import { tr } from '../../i18n';

export default function OwedStrip({ style }) {
    const { error, text, muted } = useBrand();
    const owed = useTableBill((s) => s.bill?.owed);
    if (!owed) return null;
    return (
        <Pressable onPress={() => useOwedPrompt.getState().show()} style={[{ marginHorizontal: 16, marginVertical: 8, padding: 14, borderRadius: 16, backgroundColor: alpha(error, 0.12), borderWidth: 1, borderColor: alpha(error, 0.5), flexDirection: 'row', alignItems: 'center' }, style]}>
            <Ionicons name="alert-circle" size={24} color={error} />
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={{ color: text, fontWeight: '900' }}>{tr('Unpaid bill: ₹{n}', { n: Math.round(owed.amount) })}</Text>
                <Text style={{ color: muted, fontSize: 12.5, marginTop: 2 }}>{tr('From {where}. Tap to see it and pay.', { where: whereOf(owed.table) })}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={muted} />
        </Pressable>
    );
}
