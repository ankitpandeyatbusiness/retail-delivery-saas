// Pull a bottom sheet down to close it, like every app. Wrap the sheet in <DragDown> and put the part that is held (the
// little handle and the title) inside <Grip>. Past a third of its height, or a quick flick, the sheet closes through
// onClose; let go earlier and it springs back. The position lives on the UI thread, so it follows the finger smoothly.
import React, { createContext, useContext, useEffect } from 'react';
import { View } from 'react-native';
import Reanimated, { cancelAnimation, runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';

const Ctx = createContext(null);

export function DragDown({ onClose, visible = true, children }) {
    const ty = useSharedValue(0);
    const h = useSharedValue(400);
    const start = useSharedValue(0);
    useEffect(() => { if (visible) { cancelAnimation(ty); ty.value = 0; } }, [visible]);   // eslint-disable-line react-hooks/exhaustive-deps
    const move = useAnimatedStyle(() => ({ transform: [{ translateY: ty.value }] }));
    return (
        <Ctx.Provider value={{ ty, h, start, onClose }}>
            <GestureHandlerRootView>
                <Reanimated.View style={move} onLayout={(e) => { h.value = e.nativeEvent.layout.height; }}>{children}</Reanimated.View>
            </GestureHandlerRootView>
        </Ctx.Provider>
    );
}

export function Grip({ children, style }) {
    const c = useContext(Ctx);
    if (!c) return <View style={style}>{children}</View>;
    const { ty, h, start, onClose } = c;
    const drag = Gesture.Pan()
        .onStart(() => { 'worklet'; cancelAnimation(ty); start.value = ty.value; })
        .onUpdate((e) => { 'worklet'; ty.value = Math.max(0, start.value + e.translationY); })
        .onEnd((e) => {
            'worklet';
            if (ty.value > h.value / 3 || e.velocityY > 900) runOnJS(onClose)();
            else ty.value = withSpring(0, { damping: 22, stiffness: 260 });
        });
    return <GestureDetector gesture={drag}><View collapsable={false} style={style}>{children}</View></GestureDetector>;
}
