// src/components/ui/SheetPortal.jsx
// Draws a sheet on top of the whole app, in the SAME window as the tab bar.
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { View, StyleSheet } from 'react-native';

const Ctx = createContext(null);
let nextId = 1;

// Put once in App.jsx, around the navigator.
export function SheetHost({ children }) {
    const [layers, setLayers] = useState({});
    const api = useMemo(() => ({
        put: (id, node) => setLayers((p) => ({ ...p, [id]: node })),
        drop: (id) => setLayers((p) => {
            if (!(id in p)) return p;
            const n = { ...p };
            delete n[id];
            return n;
        }),
    }), []);
    return (
        <Ctx.Provider value={api}>
            {children}
            {Object.keys(layers).map((id) => (
                <View key={id} style={StyleSheet.absoluteFill} pointerEvents="box-none">{layers[id]}</View>
            ))}
        </Ctx.Provider>
    );
}

// Anything inside <SheetPortal> is shown by the host, above everything else.
export function SheetPortal({ children }) {
    const api = useContext(Ctx);
    const id = useRef(`sheet${nextId++}`).current;
    useEffect(() => { api?.put(id, children); });   // keeps the copy fresh on every render
    useEffect(() => () => api?.drop(id), []);       // removes it when the sheet unmounts
    return null;
}