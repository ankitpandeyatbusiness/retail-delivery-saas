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
