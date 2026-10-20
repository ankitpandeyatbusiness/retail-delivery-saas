// "Choose your table": the numbers of the shop's tables as buttons. (A table QR sets this by itself.)
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useBrand, alpha } from '../common/kit';
import { Sheet } from '../owners/ui';
import { useHomeStore } from '../../store/customers/useHomeStore';
import { useTableBill } from '../../store/customers/useTableBill';
import { useOrderMode } from '../../store/customers/useOrderMode';
import { tableLock } from '../../utils/customers/tableLink';
import { showToast } from './shop';
import { tr } from '../../i18n';

export default function TableSheet({ visible, onClose }) {
    const { primary, onPrimary, text, border, muted } = useBrand();
    const count = useHomeStore((s) => s.full?.orders?.dineIn?.tableCount) || 10;
    const table = useOrderMode((s) => s.table);
    const setTable = useOrderMode((s) => s.setTable);
    const nav = useNavigation();
    return (
        <Sheet visible={visible} onClose={onClose} title={tr('Choose your table')}>
            <Pressable onPress={() => { const b = useTableBill.getState().bill; if (b?.open) { showToast(tr(tableLock('') || '')); return; } onClose(); nav.navigate('ScanTable'); }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 14, backgroundColor: primary, marginBottom: 14 }}>
                <Ionicons name="qr-code-outline" size={18} color={onPrimary} />
                <Text style={{ color: onPrimary, fontWeight: '900', marginLeft: 8 }}>{tr('Scan the QR on your table')}</Text>
            </Pressable>
            <Text style={{ color: muted, fontSize: 13, marginBottom: 12 }}>{tr('The number is on the sticker on your table.')}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginRight: -8 }}>
                {Array.from({ length: count }, (_, i) => String(i + 1)).map((n) => {
                    const on = table === n;
                    return (
                        <Pressable
                            key={n} onPress={() => { const lock = tableLock(n); if (lock) { showToast(tr(lock)); return; } setTable(n); onClose(); }}
                            style={{ width: 58, height: 52, borderRadius: 14, marginRight: 8, marginBottom: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: on ? primary : border, backgroundColor: on ? primary : alpha(primary, 0.06) }}
                        >
                            <Text style={{ color: on ? onPrimary : text, fontWeight: '900', fontSize: 17 }}>{n}</Text>
                        </Pressable>
                    );
                })}
            </View>
        </Sheet>
    );
}
