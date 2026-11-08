// What a chat shows while its messages are loading: grey bubbles (the other person's on the left, mine on the right) with a light sweep, like the real chat
// will look, instead of a spinner. Sits at the bottom, where the newest messages are, and fills the whole chat up to the top (the pattern repeats; what does not fit is clipped).
import React from 'react';
import { View } from 'react-native';
import { Skel } from './motion';

// [side, width, height]: a short one, a long one with two lines, and so on
const BUBBLES = [
    ['left', '62%', 48], ['right', '46%', 36], ['left', '40%', 36], ['right', '68%', 58],
    ['left', '54%', 36], ['right', '38%', 36], ['left', '72%', 60],
];

// three rounds of the pattern are taller than any phone's chat area
const ROWS = [...BUBBLES, ...BUBBLES, ...BUBBLES];

export default function ChatShimmer() {
    return (
        <View style={{ flex: 1, justifyContent: 'flex-end', overflow: 'hidden', paddingHorizontal: 12, paddingBottom: 8 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <View style={{ alignSelf: 'center', marginBottom: 10 }}><Skel width={72} height={22} radius={11} /></View>
            {ROWS.map(([side, width, height], i) => (
                <View key={i} style={{ alignSelf: side === 'right' ? 'flex-end' : 'flex-start', width, marginBottom: 8 }}>
                    <Skel width="100%" height={height} radius={16} />
                </View>
            ))}
        </View>
    );
}
