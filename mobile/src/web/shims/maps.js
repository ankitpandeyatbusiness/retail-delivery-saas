// Web stand-in for react-native-maps (native only). Phase 1: a quiet placeholder so every screen loads.
// Phase 6 replaces this with a real Google Maps JS component.
import React, { forwardRef, useImperativeHandle } from 'react';
import { View, Text } from 'react-native';

export const PROVIDER_GOOGLE = 'google';
export const PROVIDER_DEFAULT = null;

const none = () => null;
export const Marker = none;
export const Polyline = none;
export const Polygon = none;
export const Circle = none;
export const Callout = none;
export const Overlay = none;

// the methods screens call through a ref: all do nothing
const noop = () => {};
const MapView = forwardRef(function MapView({ style, children }, ref) {
    useImperativeHandle(ref, () => ({
        animateToRegion: noop, animateCamera: noop, fitToCoordinates: noop, fitToElements: noop,
        setCamera: noop, getCamera: async () => ({}), pointForCoordinate: async () => ({ x: 0, y: 0 }),
        coordinateForPoint: async () => ({ latitude: 0, longitude: 0 }), takeSnapshot: async () => '',
    }), []);
    return (
        <View style={[{ backgroundColor: '#e8ecef', alignItems: 'center', justifyContent: 'center', minHeight: 120 }, style]}>
            <Text style={{ color: '#6b7280', fontSize: 13 }}>Map is available in the app</Text>
            {null && children}
        </View>
    );
});
export default MapView;

// used by useRoadGlide to move a marker smoothly; here it only remembers the last value
export class AnimatedRegion {
    constructor(v = {}) { this.v = { ...v }; }
    setValue(v) { this.v = { ...this.v, ...v }; }
    timing() { return { start: (cb) => cb && cb({ finished: true }), stop: noop }; }
    spring() { return { start: (cb) => cb && cb({ finished: true }), stop: noop }; }
    stopAnimation() {}
    addListener() { return ''; }
    removeListener() {}
    removeAllListeners() {}
}
