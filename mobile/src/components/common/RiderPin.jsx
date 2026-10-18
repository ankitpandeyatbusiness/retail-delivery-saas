// The rider on a tracking map: a top-down 3D-style scooter picture whose delivery box and helmet take the SHOP'S COLOUR.
// It is three transparent PNG layers of the same size, stacked (assets/map): the scooter itself with its soft shadow, a plain white
// layer of just the box / helmet which is tinted with the colour, and the shading and highlights on top. The front wheel points UP,
// so the parent flat <Marker rotation={bearing}> makes the front wheel point the way he is going.
// onReady is called once all three layers are loaded (the marker's picture is taken then, so it never comes up half empty).
import React, { useRef } from 'react';
import { View, Image } from 'react-native';

const BASE = require('../../../assets/map/rider-base.png');
const TINT = require('../../../assets/map/rider-tint.png');
const DETAIL = require('../../../assets/map/rider-detail.png');

export const RIDER_SIZE = 72;   // dp: the width and height of the picture (the scooter itself is about 88% of this long). Change this one number to resize it.

export default function RiderPin({ color, size = RIDER_SIZE, onReady }) {
    const loaded = useRef(0);
    const one = () => { loaded.current += 1; if (loaded.current === 3) onReady?.(); };
    const layer = { position: 'absolute', left: 0, top: 0, width: size, height: size };
    return (
        <View style={{ width: size, height: size }}>
            <Image source={BASE} style={layer} fadeDuration={0} onLoad={one} />
            <Image source={TINT} style={[layer, { tintColor: color }]} fadeDuration={0} onLoad={one} />
            <Image source={DETAIL} style={layer} fadeDuration={0} onLoad={one} />
        </View>
    );
}
