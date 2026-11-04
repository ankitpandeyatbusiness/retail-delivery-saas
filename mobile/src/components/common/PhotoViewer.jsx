// A photo full screen: pinch to zoom in and out, drag a zoomed photo, double tap to zoom, swipe down or tap the cross to close.
//   <PhotoViewer uri onClose />                      the old way: one photo, open while uri is set (complaint photos, delivery proof)
//   <ZoomPress uri uris style>{a picture}</ZoomPress> any picture that opens the viewer when tapped (uris = all the pictures to page through)
//   <ZoomImage source group style ... />             an expo-image Image that opens the viewer
import React, { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming, runOnJS } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

const MAX_ZOOM = 6;
const clamp = (v, lo, hi) => {
    'worklet';
    return Math.min(Math.max(v, lo), hi);
};

// one zoomable picture
function Page({ uri, onClose, onZoomChange }) {
    const { width, height } = useWindowDimensions();
    const scale = useSharedValue(1);
    const saved = useSharedValue(1);
    const tx = useSharedValue(0);
    const ty = useSharedValue(0);
    const sx = useSharedValue(0);
    const sy = useSharedValue(0);

    useEffect(() => { scale.value = 1; saved.value = 1; tx.value = 0; ty.value = 0; sx.value = 0; sy.value = 0; }, [uri]);   // eslint-disable-line react-hooks/exhaustive-deps

    const settle = () => {
        'worklet';
        const maxX = ((scale.value - 1) * width) / 2;
        const maxY = ((scale.value - 1) * height) / 2;
        tx.value = withTiming(clamp(tx.value, -maxX, maxX), { duration: 120 });
        ty.value = withTiming(clamp(ty.value, -maxY, maxY), { duration: 120 });
        sx.value = clamp(tx.value, -maxX, maxX);
        sy.value = clamp(ty.value, -maxY, maxY);
    };
    const reset = () => {
        'worklet';
        scale.value = withTiming(1); tx.value = withTiming(0); ty.value = withTiming(0);
        sx.value = 0; sy.value = 0; saved.value = 1;
    };

    const pinch = Gesture.Pinch()
        .onUpdate((e) => { scale.value = clamp(saved.value * e.scale, 0.7, MAX_ZOOM); })
        .onEnd(() => {
            if (scale.value < 1) reset(); else { saved.value = scale.value; settle(); }
            runOnJS(onZoomChange)(saved.value > 1.02);
        });
    const pan = Gesture.Pan()
        .averageTouches(true)
        .onUpdate((e) => { if (scale.value > 1.02) { tx.value = sx.value + e.translationX; ty.value = sy.value + e.translationY; } })
        .onEnd((e) => {
            if (scale.value > 1.02) { sx.value = tx.value; sy.value = ty.value; settle(); } else if (e.translationY > 120 && Math.abs(e.translationX) < 90) runOnJS(onClose)();
        });
    const doubleTap = Gesture.Tap().numberOfTaps(2).onEnd(() => {
        if (scale.value > 1.02) { reset(); runOnJS(onZoomChange)(false); } else { scale.value = withTiming(2.5); saved.value = 2.5; runOnJS(onZoomChange)(true); }
    });

    const style = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }] }));
    const gesture = Gesture.Exclusive(doubleTap, Gesture.Simultaneous(pinch, pan));
    return (
        <GestureDetector gesture={gesture}>
            <Animated.View style={[{ width, height, alignItems: 'center', justifyContent: 'center' }, style]} renderToHardwareTextureAndroid>
                <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
            </Animated.View>
        </GestureDetector>
    );
}

export function ImageViewer({ visible, uris, start = 0, onClose }) {
    const insets = useSafeAreaInsets();
    const [i, setI] = useState(start);
    const [zoomed, setZoomed] = useState(false);
    useEffect(() => { if (visible) { setI(start); setZoomed(false); } }, [visible, start]);
    const go = useCallback((d) => { setI((v) => Math.min(Math.max(v + d, 0), uris.length - 1)); setZoomed(false); }, [uris.length]);
    if (!visible || !uris || !uris.length) return null;
    return (
        <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
            <GestureHandlerRootView style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.96)' }}>
                <Page uri={uris[i]} onClose={onClose} onZoomChange={setZoomed} />
                <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close" style={[st.close, { top: insets.top + 10 }]}>
                    <Ionicons name="close" size={24} color="#FFFFFF" />
                </Pressable>
                {uris.length > 1 ? (
                    <>
                        <Text style={[st.count, { top: insets.top + 16 }]}>{i + 1} / {uris.length}</Text>
                        {!zoomed && i > 0 ? <Pressable onPress={() => go(-1)} hitSlop={10} style={[st.arrow, { left: 12 }]}><Ionicons name="chevron-back" size={22} color="#FFFFFF" /></Pressable> : null}
                        {!zoomed && i < uris.length - 1 ? <Pressable onPress={() => go(1)} hitSlop={10} style={[st.arrow, { right: 12 }]}><Ionicons name="chevron-forward" size={22} color="#FFFFFF" /></Pressable> : null}
                    </>
                ) : null}
            </GestureHandlerRootView>
        </Modal>
    );
}

// the old one-photo way: open while a uri is set
export default function PhotoViewer({ uri, onClose }) {
    return <ImageViewer visible={!!uri} uris={uri ? [uri] : []} onClose={onClose} />;
}

// a picture (any children) that opens the viewer when tapped
export function ZoomPress({ uri, uris, children, style }) {
    const [open, setOpen] = useState(false);
    const list = (uris && uris.length ? uris : [uri]).filter(Boolean);
    const start = Math.max(0, list.indexOf(uri));
    if (!list.length) return children;
    return (
        <>
            <Pressable onPress={() => setOpen(true)} accessibilityRole="imagebutton" accessibilityLabel="Open the picture" style={style}>{children}</Pressable>
            <ImageViewer visible={open} uris={list} start={start} onClose={() => setOpen(false)} />
        </>
    );
}

// an expo-image Image that opens the viewer. Same props as Image, plus group (all pictures to page through).
export function ZoomImage({ source, group, style, ...rest }) {
    const uri = source && source.uri;
    if (!uri) return <Image source={source} style={style} {...rest} />;
    return (
        <ZoomPress uri={uri} uris={group}>
            <Image source={source} style={style} {...rest} />
        </ZoomPress>
    );
}

const st = StyleSheet.create({
    close: { position: 'absolute', right: 14, width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
    count: { position: 'absolute', alignSelf: 'center', left: 0, right: 0, textAlign: 'center', color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
    arrow: { position: 'absolute', top: '50%', width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
});
