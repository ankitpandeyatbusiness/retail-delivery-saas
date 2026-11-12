// Two columns that FILL EVENLY: each block goes under the shorter column, so a tall block on one side never leaves the other side empty while the page scrolls.
//   <Masonry desk>  block  block  <Sep />  block ... </Masonry>
// Blocks are the children (a fragment is one block); <Sep /> glues what is between two separators into one block (a title with its card).
// Heights are measured once, on a hidden copy, then the blocks are placed. The placement is kept until the blocks themselves change, so typing in a form never makes
// a block jump to the other side. When desk is false (the phone, a narrow window) the children are drawn as they are, one under the other.
import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

export const Sep = () => null;

const units = (children) => {
    const all = React.Children.toArray(children).filter(Boolean);
    // with no <Sep /> in it, every child is a block of its own; with separators, what lies between two of them is one block
    if (!all.some((c) => c.type === Sep)) return all.map((c) => [c]);
    const out = [[]];
    all.forEach((c) => {
        if (c.type === Sep) { if (out[out.length - 1].length) out.push([]); } else out[out.length - 1].push(c);
    });
    return out.filter((u) => u.length);
};

// aligned: the blocks sit in ROWS of two with their tops level (headings side by side). The blocks are paired by height (the two tallest together, and so on), so the
// space left under the shorter block of each row is as small as it can be; without it the blocks fill the columns unevenly but with no gaps.
export default function Masonry({ desk, gap = 16, aligned, children }) {
    const list = units(children);
    const sig = list.map((u) => u.map((c) => c.key).join(',')).join('|');
    const [w, setW] = useState(0);
    const [place, setPlace] = useState(null);   // { sig, cols: [[unit index]] }
    const heights = useRef({});
    const [, bump] = useState(0);

    useEffect(() => { heights.current = {}; }, [sig]);

    const colW = w ? Math.floor((w - gap) / 2) : 0;
    const ready = place && place.sig === sig;
    // each block goes under the shorter column; when two columns are equal (or a height is not known yet) the blocks take turns, so they never all pile up on the left
    const placeNow = () => {
        if (aligned) {
            const H = (k) => (heights.current[k] > 0 ? heights.current[k] : 160);
            // the least empty space overall: sort the blocks by height and pair neighbours (the two tallest, the next two...), so each pair is as level as it can be;
            // then the rows go back into the page's own order (by the first block of each pair)
            const order = list.map((_, k) => k).sort((x, y) => H(y) - H(x));
            const rows = [];
            for (let i = 0; i < order.length; i += 2) {
                const pair = [order[i], i + 1 < order.length ? order[i + 1] : null];
                if (pair[1] !== null && pair[1] < pair[0]) pair.reverse();
                rows.push(pair);
            }
            rows.sort((p, q) => p[0] - q[0]);
            setPlace({ sig, rows });
            bump((n) => n + 1);
            return;
        }
        const colH = [0, 0];
        const cols = [[], []];
        list.forEach((u, k) => {
            const h = heights.current[k];
            const c = colH[0] < colH[1] ? 0 : colH[1] < colH[0] ? 1 : k % 2;
            cols[c].push(k);
            colH[c] += h > 0 ? h : 160;
        });
        setPlace({ sig, cols });
        bump((n) => n + 1);
    };
    const measured = (i, h) => {
        heights.current[i] = h;
        if (Object.keys(heights.current).length < list.length) return;
        placeNow();
    };
    // if some block never reports its size, place them with what is known after a moment
    useEffect(() => {
        if (!desk || ready || !colW) return undefined;
        const t = setTimeout(placeNow, 600);
        return () => clearTimeout(t);
    });   // eslint-disable-line react-hooks/exhaustive-deps

    if (!desk) return <>{children}</>;   // (after every hook above, so the order of hooks never changes)

    return (
        <View onLayout={(e) => { const x = Math.round(e.nativeEvent.layout.width); if (x && x !== w) setW(x); }} style={{ width: '100%' }}>
            {ready && place.rows ? (
                <View>
                    {place.rows.map((r, i) => (
                        <View key={`r${i}`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                            <View style={{ flex: 1, minWidth: 0 }}>{list[r[0]]}</View>
                            <View style={{ flex: 1, minWidth: 0, marginLeft: gap }}>{r[1] != null ? list[r[1]] : null}</View>
                        </View>
                    ))}
                </View>
            ) : ready ? (
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
