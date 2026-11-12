// Marks a button that a tutorial step can circle. Everywhere else, and whenever no step points at it, it renders its children EXACTLY as
// they are (no extra view, nothing changes): only while the running step names this id does it wrap them to measure the place and
// notice the tap. The tap still reaches the button.
import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { useTutorialStore } from './store';

const rects = {};                 // id -> { x, y, w, h } in window coordinates
const listeners = new Set();
export const getRect = (id) => rects[id] || null;
export const onRect = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const setRect = (id, r) => { rects[id] = r; listeners.forEach((fn) => fn(id)); };
const clearRect = (id) => { delete rects[id]; listeners.forEach((fn) => fn(id)); };

export function CoachTarget({ id, children, style }) {
    const active = useTutorialStore((s) => s.targetId === id);
    const ref = useRef(null);
    useEffect(() => {
        if (!active) return undefined;
        const measure = () => {
            try {
                ref.current?.measureInWindow?.((x, y, w, h) => { if (w > 0 && h > 0) setRect(id, { x, y, w, h }); });
            } catch (e) { /* not measurable now */ }
        };
        measure();
        const t = setInterval(measure, 400);   // the screen may still be moving or scrolling
        return () => { clearInterval(t); clearRect(id); };
    }, [active, id]);
    if (!active) return children;
    return (
        <View ref={ref} collapsable={false} style={style} onTouchEndCapture={() => useTutorialStore.getState().tapped(id)} onClickCapture={() => useTutorialStore.getState().tapped(id)}>
            {children}
        </View>
    );
}

export default CoachTarget;
