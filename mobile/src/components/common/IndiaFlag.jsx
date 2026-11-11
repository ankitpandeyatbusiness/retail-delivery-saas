// The Indian flag as a small picture (3 bands + the 24-spoke Ashoka Chakra). Windows browsers cannot draw the flag emoji (they show "IN" or
// nothing), so the login screens use this instead. No package needed: an inline SVG shown by expo-image.
import React from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';

const FLAG_URI = (() => {
    let spokes = '';
    for (let i = 0; i < 24; i += 1) {
        const a = (i * 15 * Math.PI) / 180;
        spokes += `<line x1='450' y1='300' x2='${(450 + 82 * Math.cos(a)).toFixed(1)}' y2='${(300 + 82 * Math.sin(a)).toFixed(1)}' stroke='#000080' stroke-width='5'/>`;
        const b = a + (7.5 * Math.PI) / 180;   // the small notch on the rim between spokes
        spokes += `<circle cx='${(450 + 76 * Math.cos(b)).toFixed(1)}' cy='${(300 + 76 * Math.sin(b)).toFixed(1)}' r='4.5' fill='#000080'/>`;
    }
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 900 600'><rect width='900' height='200' fill='#FF9933'/><rect y='200' width='900' height='200' fill='#fff'/><rect y='400' width='900' height='200' fill='#138808'/><circle cx='450' cy='300' r='88' fill='none' stroke='#000080' stroke-width='8'/><circle cx='450' cy='300' r='14' fill='#000080'/>${spokes}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
})();

export default function IndiaFlag({ width = 30, height = 20, style }) {
    return (
        <View style={[{ width, height, borderRadius: 3, overflow: 'hidden' }, style]}>
            <Image source={{ uri: FLAG_URI }} style={{ width: '100%', height: '100%' }} contentFit="fill" />
        </View>
    );
}
