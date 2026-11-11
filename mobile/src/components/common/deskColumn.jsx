// Puts a phone screen on the DESKTOP website as a page: centred in a column of a comfortable width (instead of stretched across a wide window), under the
// website's top bar, with the screen's own header (BackHeader / PageHeader) drawn in its desktop look.
// In the phone app, and in a narrow browser, the screen is returned exactly as it is: nothing is wrapped.
import React from 'react';
import { View, Platform } from 'react-native';
import { useBrand } from './kit';
import { useIsDesktopWeb } from '../../utils/common/layout';

export function deskColumn(Component, maxWidth = 860) {
    if (Platform.OS !== 'web') return Component;   // the phone app gets the screen itself: not even a wrapper
    function Framed(props) {
        const desk = useIsDesktopWeb();
        const { background } = useBrand();
        if (!desk) return <Component {...props} />;
        return (
            <View style={{ flex: 1, backgroundColor: background }}>
                <View style={{ flex: 1, width: '100%', maxWidth, alignSelf: 'center' }}>
                    <Component {...props} />
                </View>
            </View>
        );
    }
    Framed.displayName = `DeskColumn(${Component.displayName || Component.name || 'Screen'})`;
    return Framed;
}
