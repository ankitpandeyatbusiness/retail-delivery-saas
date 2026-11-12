// A list of cards, for the DESKTOP website: two (or `cols`) across instead of one long column. Children that are false/null are skipped.
// On the phone, and in a narrow browser, the children are returned exactly as they are.
import React from 'react';
import { View } from 'react-native';
import { useIsDesktopWeb } from '../../utils/common/layout';

export default function DeskGrid({ children, cols = 2 }) {
    const desk = useIsDesktopWeb();
    if (!desk) return <>{children}</>;
    const list = React.Children.toArray(children).filter(Boolean);
    return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 8 }}>
            {list.map((c, i) => <View key={c.key || i} style={{ width: `${100 / cols}%`, minWidth: 340 }}>{c}</View>)}
        </View>
    );
}

// A page of blocks, for the DESKTOP website: the first half of the blocks in one column, the rest in a second one, on a page as wide as the window allows.
// On the phone, and in a narrow browser, the children are returned exactly as they are.
export function DeskCols({ children }) {
    const desk = useIsDesktopWeb();
    if (!desk) return <>{children}</>;
    const list = React.Children.toArray(children).filter(Boolean);
    const mid = Math.ceil(list.length / 2);
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24, width: '100%', maxWidth: 1180, alignSelf: 'center', paddingHorizontal: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }}>{list.slice(0, mid)}</View>
            <View style={{ flex: 1, minWidth: 0 }}>{list.slice(mid)}</View>
        </View>
    );
}
