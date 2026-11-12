// Two columns that FILL EVENLY: each block goes under the shorter column, so a tall block on one side never leaves the other side empty while the page scrolls.
//   <Masonry desk>  block  block  <Sep />  block ... </Masonry>
// Blocks are the children (a fragment is one block); with <Sep /> in it, what lies between two separators is one block (a title with its card).
// The first time, each block is measured on a hidden copy and then placed. After that the page never goes blank: a block that was there keeps its place, a new block is
// added under the shorter column (its height is read once it is on screen), and typing in a form never makes a block jump to the other side.
// When desk is false (the phone, a narrow window) the children are drawn as they are, one under the other.
//   aligned: the blocks sit in ROWS of two with their tops level (headings side by side), paired by height (the two tallest together, and so on), so the empty space
//   under the shorter block of each row is as small as it can be.
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
const keyOf = (u) => u.map((c) => c.key).join(',');

export default function Masonry({ desk, gap = 16, aligned, children }) {
    const list = units(children);
    const keys = list.map(keyOf);
    const [w, setW] = useState(0);
    const [placed, setPlaced] = useState(false);   // the first placement (after the hidden measuring) has happened
    const [, bump] = useState(0);
    const hmap = useRef({});     // block key -> its height
    const colOf = useRef({});    // block key -> column (0 or 1)

    const H = (k) => (hmap.current[k] > 0 ? hmap.current[k] : 160);

    // where every block goes right now, from what is known (never from a fresh measuring)
    const layout = () => {
        if (aligned) {
            const order = keys.map((_, i) => i).sort((x, y) => H(keys[y]) - H(keys[x]));
            const rows = [];
            for (let i = 0; i < order.length; i += 2) {
                const pair = [order[i], i + 1 < order.length ? order[i + 1] : null];
                if (pair[1] !== null && pair[1] < pair[0]) pair.reverse();
                rows.push(pair);
            }
            rows.sort((p, q) => p[0] - q[0]);
            return { rows };
        }
        const colH = [0, 0];
        const cols = [[], []];
        // the blocks that already have a column keep it
        keys.forEach((k, i) => { const c = colOf.current[k]; if (c === 0 || c === 1) { cols[c].push(i); colH[c] += H(k); } });
        keys.forEach((k, i) => {
            if (colOf.current[k] === 0 || colOf.current[k] === 1) return;
            const c = colH[0] < colH[1] ? 0 : colH[1] < colH[0] ? 1 : i % 2;
            colOf.current[k] = c; cols[c].push(i); colH[c] += H(k);
        });
        cols.forEach((c) => c.sort((a, b) => a - b));
        return { cols };
    };

    // the layout is worked out again only when the blocks themselves change (never because a block grew while someone typed in it)
    const cache = useRef({ sig: null, L: null });
    const sig = keys.join('|');
    const current = () => { if (cache.current.sig !== sig) cache.current = { sig, L: layout() }; return cache.current.L; };
    const colW = w ? Math.floor((w - gap) / 2) : 0;
    const placeNow = () => { cache.current = { sig: null, L: null }; current(); setPlaced(true); bump((n) => n + 1); };
    const measured = (k, h) => {
        hmap.current[k] = h;
        if (placed) return;
        if (keys.every((x) => hmap.current[x] > 0)) placeNow();
    };
    // if a block never reports its size, place them with what is known after a moment
    useEffect(() => {
        if (!desk || placed || !colW) return undefined;
        const t = setTimeout(placeNow, 600);
        return () => clearTimeout(t);
    });   // eslint-disable-line react-hooks/exhaustive-deps

    if (!desk) return <>{children}</>;   // (after every hook above, so the order of hooks never changes)

    // each block on screen reports its height (kept for later changes); nothing is moved because of it
    const wrap = (k, node) => <View key={`u${k}`} onLayout={(e) => { hmap.current[k] = e.nativeEvent.layout.height; }}>{node}</View>;

    return (
        <View onLayout={(e) => { const x = Math.round(e.nativeEvent.layout.width); if (x && x !== w) setW(x); }} style={{ width: '100%' }}>
            {placed ? (() => {
                const L = current();
                if (L.rows) {
                    return (
                        <View>
                            {L.rows.map((r) => (
                                <View key={`r${keys[r[0]]}`} style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                                    <View style={{ flex: 1, minWidth: 0 }}>{wrap(keys[r[0]], list[r[0]])}</View>
                                    <View style={{ flex: 1, minWidth: 0, marginLeft: gap }}>{r[1] != null ? wrap(keys[r[1]], list[r[1]]) : null}</View>
                                </View>
                            ))}
                        </View>
                    );
                }
                return (
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                        {L.cols.map((idx, c) => (
                            <View key={c} style={{ flex: 1, minWidth: 0, marginLeft: c ? gap : 0 }}>
                                {idx.map((i) => wrap(keys[i], list[i]))}
                            </View>
                        ))}
                    </View>
                );
            })() : (
                // the very first time: a hidden copy of each block at column width, only to read its height
                <View style={{ position: 'absolute', top: 0, left: 0, opacity: 0 }} pointerEvents="none">
                    {colW ? list.map((u, i) => (
                        <View key={`m${keys[i]}`} style={{ width: colW }} onLayout={(e) => measured(keys[i], e.nativeEvent.layout.height)}>{u}</View>
                    )) : null}
                </View>
            )}
        </View>
    );
}
