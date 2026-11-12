// Two columns that FILL EVENLY: each block goes under the shorter column, so a tall block on one side never leaves the other side empty while the page scrolls.
//   <Masonry desk>  block  block  <Sep />  block ... </Masonry>
// Blocks are the children (a fragment is one block); <Sep /> glues what is between two separators into one block (a title with its card).
// Heights are measured once, on a hidden copy, then the blocks are placed. The placement is kept until the blocks themselves change, so typing in a form never makes
// a block jump to the other side. When desk is false (the phone, a narrow window) the children are drawn as they are, one under the other.
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

export const Sep = () => null;

const units = (children) => {
    const out = [[]];
    React.Children.toArray(children).forEach((c) => {
        if (!c) return;
        if (c.type === Sep) { if (out[out.length - 1].length) out.push([]); } else out[out.length - 1].push(c);
    });
    return out.filter((u) => u.length);
};

export default function Masonry({ desk, gap = 16, children }) {
    const list = units(children);
    const sig = list.map((u) => u.map((c) => c.key).join(',')).join('|');
    const [w, setW] = useState(0);
    const [place, setPlace] = useState(null);   // { sig, cols: [[unit index]] }
    const heights = useRef({});
    const [, bump] = useState(0);

    useEffect(() => { heights.current = {}; }, [sig]);
    if (!desk) return <>{children}</>;

    const colW = w ? Math.floor((w - gap) / 2) : 0;
    const ready = place && place.sig === sig;
    const measured = (i, h) => {
        heights.current[i] = h;
        if (Object.keys(heights.current).length < list.length) return;
        const colH = [0, 0];
        const cols = [[], []];
        list.forEach((u, k) => { const c = colH[0] <= colH[1] ? 0 : 1; cols[c].push(k); colH[c] += heights.current[k] || 0; });
        setPlace({ sig, cols });
        bump((n) => n + 1);
    };

    return (
        <View onLayout={(e) => { const x = Math.round(e.nativeEvent.layout.width); if (x && x !== w) setW(x); }} style={{ width: '100%' }}>
            {ready ? (
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                    {place.cols.map((idx, c) => (
                        <View key={c} style={{ flex: 1, minWidth: 0, marginLeft: c ? gap : 0 }}>
                            {idx.map((k) => <React.Fragment key={`u${k}`}>{list[k]}</React.Fragment>)}
                        </View>
                    ))}
                </View>
            ) : (
                // before the blocks are placed: a hidden copy of each at column width, only to read its height (a short flash of the plain order at most)
                <View style={{ position: 'absolute', top: 0, left: 0, opacity: 0 }} pointerEvents="none">
                    {colW ? list.map((u, i) => (
                        <View key={`m${i}`} style={{ width: colW }} onLayout={(e) => measured(i, e.nativeEvent.layout.height)}>{u}</View>
                    )) : null}
                </View>
            )}
        </View>
    );
}
