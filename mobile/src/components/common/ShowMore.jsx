// A list that opens with its first few entries and a "Show more" under them, on a computer. On the phone it draws every entry (or the first `phoneMax`, where the
// page already had a limit), exactly as before.
//   <Limited items={list} render={(item, i) => <Row key={item.id} .../>} />
import React, { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useBrand, alpha } from './kit';
import { useIsDesktopWeb } from '../../utils/common/layout';
import { tr } from '../../i18n';

export default function Limited({ items, render, first = 4, step = 4, phoneMax }) {
    const desk = useIsDesktopWeb();
    const { primary, muted } = useBrand();
    const [n, setN] = useState(first);
    const list = items || [];
    const shown = desk ? list.slice(0, n) : (phoneMax ? list.slice(0, phoneMax) : list);
    const left = desk ? list.length - shown.length : 0;
    return (
        <>
            {shown.map((x, i) => <React.Fragment key={i}>{render(x, i)}</React.Fragment>)}
            {left > 0 ? (
                <Pressable onPress={() => setN((v) => v + step)} accessibilityRole="button" style={({ hovered }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: alpha(muted, 0.2), cursor: 'pointer', opacity: hovered ? 0.8 : 1 })}>
                    <Text style={{ color: primary, fontWeight: '800', fontSize: 13.5 }}>{tr('Show more')} ({left})</Text>
                    <Ionicons name="chevron-down" size={16} color={primary} style={{ marginLeft: 4 }} />
                </Pressable>
            ) : null}
        </>
    );
}
